from datetime import datetime
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib import error, request
from http.server import ThreadingHTTPServer

from agent import LibraryAgent
from model_client import AgentError, DeepSeekClient, Settings
from repository import LibraryRepository
from server import Application, make_handler
from demo_agent import DemoAgent
from data_gateway import create_repository, HTTPDataRepository
from tools import LibraryTools


def response(content=None, calls=None):
    message = {"role": "assistant", "content": content}
    if calls:
        message["tool_calls"] = calls
    return {"choices": [{"finish_reason": "tool_calls" if calls else "stop", "message": message}]}


def tool_call(name, args, call_id="test-call"):
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}


class FakeClient:
    def __init__(self, replies):
        self.replies = iter(replies)
        self.requests = []

    def complete(self, messages, tools):
        self.requests.append(json.loads(json.dumps(messages)))
        return next(self.replies)


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="library_agent_test_")
        self.now = datetime.fromisoformat("2026-10-29T14:00:00+08:00").timestamp()
        self.repo = LibraryRepository(Path(self.temp.name) / "test.sqlite3", clock=lambda: self.now)
        self.tools = LibraryTools(self.repo)
        self.times = {"start_at": "2026-10-29T14:05:00+08:00", "end_at": "2026-10-29T16:05:00+08:00"}

    def tearDown(self):
        self.temp.cleanup()

    def call(self, name, args):
        return self.tools.call(name, json.dumps(args, ensure_ascii=False))

    def reserve(self, seat="DEMO-S02", owner="demo-reader"):
        proposal = self.repo.prepare_action(owner, "reserve", {"seat_id": seat, **self.times})
        return proposal, self.repo.confirm_action(owner, proposal["action_id"])

    def test_chinese_index_and_location_are_grounded(self):
        result = self.call("search_books", {"query": "人工智能 教育 入门", "limit": 2})
        self.assertEqual(result["items"][0]["id"], "DEMO-B01")
        self.assertEqual(result["items"][0]["availability"], "unknown")
        self.assertTrue(result["items"][0]["is_demo"])
        self.assertEqual(self.repo.locate_book("DEMO-B01")["shelf_id"], "DEMO-SHELF-01")
        with self.assertRaises(AgentError):
            self.repo.locate_book("NONEXISTENT")

    def test_csv_upsert_and_missing_optional_fields(self):
        path = Path(self.temp.name) / "books.csv"
        path.write_text("id,title,author,source\nREAL-1,教育统计,资料编者,人工演示\n", encoding="utf-8-sig")
        self.repo.import_books(path)
        self.repo.import_books(path)
        results = self.repo.search_books("教育统计")["items"]
        self.assertEqual(len([r for r in results if r["id"] == "REAL-1"]), 1)
        item = next(r for r in results if r["id"] == "REAL-1")
        self.assertTrue(item["is_demo"])
        self.assertIsNone(item["floor"])

    def test_tool_argument_validation_and_no_confirmation_tool(self):
        for name, args in [("search_books", {"query": "教育", "limit": True}),
                           ("search_books", {"query": "教育", "sql": "DROP TABLE books"}),
                           ("confirm_action", {"action_id": "guessed"})]:
            self.assertIn("error", self.call(name, args))
        self.assertIn("error", self.tools.call("search_books", "{broken"))

    def test_prepare_does_not_reserve_and_confirm_is_idempotent(self):
        action = self.call("prepare_booking", {"seat_id": "DEMO-S02", **self.times})
        before = self.repo.search_seats(**self.times)["items"]
        self.assertIn("DEMO-S02", [s["id"] for s in before])
        first = self.repo.confirm_action(self.tools.owner, action["action_id"])
        second = self.repo.confirm_action(self.tools.owner, action["action_id"])
        self.assertEqual(first, second)
        with self.repo.connect() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM bookings").fetchone()[0], 1)

    def test_conflicting_confirmations_are_rechecked(self):
        a = self.repo.prepare_action("reader-a", "reserve", {"seat_id": "DEMO-S02", **self.times})
        b = self.repo.prepare_action("reader-b", "reserve", {"seat_id": "DEMO-S02", **self.times})
        self.repo.confirm_action("reader-a", a["action_id"])
        with self.assertRaisesRegex(AgentError, "已被预约"):
            self.repo.confirm_action("reader-b", b["action_id"])

    def test_booking_lifecycle_and_owner_boundary(self):
        _, booking = self.reserve()
        with self.assertRaises(AgentError):
            self.repo.get_booking("other-reader", booking["id"])
        checkin = self.call("prepare_booking_change", {"booking_id": booking["id"], "operation": "check_in"})
        result = self.repo.confirm_action(self.tools.owner, checkin["action_id"])
        self.assertEqual(result["status"], "checked_in")
        release = self.call("prepare_booking_change", {"booking_id": booking["id"], "operation": "release"})
        self.assertEqual(self.repo.confirm_action(self.tools.owner, release["action_id"])["status"], "completed")

    def test_expiry_and_naive_time_rejection(self):
        _, booking = self.reserve()
        self.now += 21 * 60
        self.assertEqual(self.repo.get_booking(self.tools.owner, booking["id"])["status"], "expired")
        result = self.call("search_seats", {"start_at": "2026-10-30T14:00:00", "end_at": "2026-10-30T16:00:00"})
        self.assertIn("error", result)

    def test_feedback_is_not_submitted_until_confirmation(self):
        proposal = self.call("prepare_feedback", {"category": "设备故障", "location": "演示北区", "description": "插座无法供电"})
        with self.repo.connect() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM tickets").fetchone()[0], 0)
        receipt = self.repo.confirm_action(self.tools.owner, proposal["action_id"])
        ticket = self.repo.get_feedback(self.tools.owner, receipt["id"])
        self.assertFalse(ticket["officially_submitted"])
        with self.assertRaises(AgentError):
            self.repo.get_feedback("other-reader", receipt["id"])

    def test_model_tool_loop_round_trips_result_and_preserves_turns(self):
        client = FakeClient([
            response(calls=[tool_call("search_books", {"query": "人工智能 教育"})]),
            response("可参考演示书目[book:DEMO-B01]。"), response("这是演示数据。"),
        ])
        agent = LibraryAgent(client, self.tools)
        result = agent.chat("想找人工智能与教育的入门书")
        sent = client.requests[1]
        self.assertEqual(sent[-1]["role"], "tool")
        self.assertIn("DEMO-B01", sent[-1]["content"])
        self.assertEqual(len(result["tool_results"]), 1)
        agent.chat("是真的吗？", result["session_id"])
        self.assertTrue(any(m["role"] == "tool" for m in client.requests[2]))

    def test_model_can_only_prepare_and_invalid_arguments_are_returned(self):
        client = FakeClient([
            response(calls=[tool_call("prepare_feedback", {"category": "设备故障", "location": "演示北区", "description": "插座坏了"})]),
            response("请确认提交。"),
        ])
        result = LibraryAgent(client, self.tools).chat("反映插座问题")
        self.assertEqual(len(result["pending_actions"]), 1)
        with self.repo.connect() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM tickets").fetchone()[0], 0)
        bad_call = tool_call("search_books", {"query": "教育"})
        bad_call["function"]["arguments"] = "not-json"
        bad_client = FakeClient([response(calls=[bad_call]), response("请重新表达。")])
        bad = LibraryAgent(bad_client, self.tools).chat("找书")
        self.assertIn("error", bad["tool_results"][0]["result"])

    def test_tool_loop_has_a_call_bound(self):
        client = FakeClient([response(calls=[tool_call("search_books", {"query": "教育"})]) for _ in range(2)])
        result = LibraryAgent(client, self.tools, Settings(max_rounds=2)).chat("找书")
        self.assertIn("上限", result["answer"])
        self.assertEqual(len(client.requests), 2)

    def test_feedback_full_staff_reader_workflow_and_history(self):
        proposal = self.call("prepare_feedback", {"category": "设备故障", "location": "演示北区", "description": "插座待检查"})
        tid = self.repo.confirm_action(self.tools.owner, proposal["action_id"])["id"]
        with self.assertRaises(AgentError):
            self.repo.update_ticket("other-reader", tid, "confirm")
        self.assertEqual(self.repo.update_ticket(self.tools.owner, tid, "accept", staff=True)["status"], "processing")
        with self.assertRaises(AgentError):
            self.repo.update_ticket(self.tools.owner, tid, "reply", "", staff=True)
        replied = self.repo.update_ticket(self.tools.owner, tid, "reply", "已完成演示维修", staff=True)
        self.assertEqual(replied["status"], "replied")
        closed = self.repo.update_ticket(self.tools.owner, tid, "confirm")
        self.assertEqual(closed["status"], "closed")
        self.assertEqual([h["status"] for h in closed["history"]], ["pending", "processing", "replied", "closed"])

    def test_disabled_seat_is_rechecked_at_confirmation(self):
        action = self.repo.prepare_action(self.tools.owner, "reserve", {"seat_id": "DEMO-S02", **self.times})
        self.repo.set_seat_disabled("DEMO-S02", True)
        with self.assertRaisesRegex(AgentError, "停用"):
            self.repo.confirm_action(self.tools.owner, action["action_id"])
        seats = self.repo.search_seats(**self.times)["items"]
        self.assertNotIn("DEMO-S02", [s["id"] for s in seats])

    def test_institution_profiles_persist_and_preserve_business_records(self):
        _, booking = self.reserve()
        before = self.repo.my_services(self.tools.owner)
        again = LibraryRepository(self.repo.path, clock=lambda: self.now)
        self.assertEqual(len(again.list_institution_profiles()), 2)
        self.assertEqual(again.my_services(self.tools.owner), before)
        university = self.call("get_institution_profile", {"profile_id": "university"})
        self.assertIn("2001年8月", university["content"])
        self.assertEqual(university["source_updated_at"], "2026-10")
        library = self.call("get_institution_profile", {"profile_id": "library"})
        self.assertEqual(library["source_updated_at"], "2025-12")
        self.assertIn("不代表本站", library["note"])
        with self.repo.connect() as con:
            con.execute("UPDATE institution_profiles SET content=? WHERE id=?", ("数据库读取测试", "library"))
        self.assertEqual(self.call("get_institution_profile", {"profile_id": "library"})["content"], "数据库读取测试")
        self.assertIn("error", self.call("get_institution_profile", {"profile_id": "unknown"}))

    def test_profile_questions_use_sourced_tool_and_leave_book_queries_intact(self):
        agent = DemoAgent(self.tools)
        for question, profile_id in [("介绍一下江苏大学", "university"), ("那图书馆呢？", "library"),
                                     ("江苏大学的校训是什么", "university"), ("介绍一下江苏大学图书馆", "library")]:
            result = agent.chat(question)
            self.assertEqual(result["tool_results"][0]["tool"], "get_institution_profile")
            self.assertEqual(result["tool_results"][0]["result"]["id"], profile_id)
            self.assertIn("核验：2026-11-08", result["answer"])
            self.assertFalse(result["pending_actions"])
        for question in ["找《江苏大学图书馆简介》", "这个网站有什么功能", "介绍一下图书馆的预约规则",
                         "说说图书馆的开放时间", "帮我反馈图书馆介绍牌坏了", "图书馆有没有介绍中国历史的书", "找江苏大学简介这本书",
                         "介绍一下南京大学图书馆", "江苏大学图书馆什么时候成立", "江苏大学图书馆校址在哪里"]:
            result = agent.chat(question)
            self.assertFalse(any(item["tool"] == "get_institution_profile" for item in result["tool_results"]))

    def test_map_does_not_disclose_another_readers_booking_id(self):
        _, booking = self.reserve(owner="other-reader")
        result = self.repo.seat_map(self.tools.owner, **self.times)
        seat = next(s for s in result["items"] if s["id"] == "DEMO-S02")
        self.assertEqual(seat["status"], "reserved")
        self.assertIsNone(seat["my_booking_id"])
        self.assertNotIn(booking["id"], json.dumps(result))

    def test_no_key_demo_is_explicit_and_queries_real_demo_store(self):
        demo = DemoAgent(self.tools)
        books = demo.chat("找人工智能与教育的入门书")
        self.assertEqual(books["mode"], "rule_demo")
        self.assertEqual(books["tool_results"][0]["result"]["items"][0]["id"], "DEMO-B01")
        seats = demo.chat("明天14:00到16:00，需要有插座的安静座位")
        self.assertTrue(all(s["has_power"] and s["quiet_zone"] for s in seats["tool_results"][0]["result"]["items"]))
        prepared = demo.chat("预约第一个", seats["session_id"])
        self.assertEqual(len(prepared["pending_actions"]), 1)
        with self.repo.connect() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM bookings").fetchone()[0], 0)
        switched = demo.chat("找心理学的入门书", seats["session_id"])
        self.assertEqual(switched["tool_results"][0]["tool"], "search_books")

    def test_rule_demo_knowledge_is_helpful_and_honest(self):
        demo = DemoAgent(self.tools)
        self.assertIn("本地规则引擎", demo.chat("你能做什么？")["answer"])
        self.assertIn("没有接入", demo.chat("图书馆几点开门？")["answer"])
        self.assertIn("不是大模型", demo.chat("你是大模型吗？")["answer"])
        self.assertIn("6 条书目", demo.chat("这个网站有什么功能？")["answer"])
        self.assertIn("还没有预约", demo.chat("我的预约")["answer"])

    def test_rule_demo_chinese_times_ordinal_and_book_location(self):
        demo = DemoAgent(self.tools)
        seats = demo.chat("明天下午2点到4点，找有插座的安静座位")
        found = seats["tool_results"][0]["result"]
        self.assertEqual(found["start_at"], "2026-10-30T14:00:00+08:00")
        self.assertEqual(found["end_at"], "2026-10-30T16:00:00+08:00")
        prepared = demo.chat("选第二个", seats["session_id"])
        self.assertEqual(prepared["pending_actions"][0]["preview"]["seat_id"], found["items"][1]["id"])
        books = demo.chat("找人工智能与教育的入门书", seats["session_id"])
        self.assertEqual(books["tool_results"][0]["result"]["items"][0]["id"], "DEMO-B01")
        located = demo.chat("第一本在哪里？", seats["session_id"])
        self.assertEqual(located["tool_results"][0]["tool"], "locate_book")
        self.assertEqual(located["tool_results"][0]["result"]["id"], "DEMO-B01")

    def test_rule_demo_record_query_and_change_require_confirmation(self):
        _, booking = self.reserve()
        demo = DemoAgent(self.tools)
        queried = demo.chat(f"查询 {booking['id']}")
        self.assertEqual(queried["tool_results"][0]["result"]["id"], booking["id"])
        cancelled = demo.chat(f"取消预约 {booking['id']}", queried["session_id"])
        self.assertEqual(cancelled["pending_actions"][0]["kind"], "cancel")
        self.assertEqual(self.repo.get_booking(self.tools.owner, booking["id"])["status"], "reserved")

    def test_rule_demo_feedback_guidance_and_concrete_preview(self):
        demo = DemoAgent(self.tools)
        guidance = demo.chat("怎么报修？")
        self.assertIn("问题类型", guidance["answer"])
        self.assertEqual(guidance["pending_actions"], [])
        prepared = demo.chat("反馈3楼北区的插座坏了，需要检查", guidance["session_id"])
        self.assertEqual(prepared["pending_actions"][0]["kind"], "feedback")
        with self.repo.connect() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM tickets").fetchone()[0], 0)

    def test_actual_confirmation_receipts_reach_next_model_turn(self):
        client = FakeClient([response("请查询预约记录。")])
        agent = LibraryAgent(client, self.tools)
        _, booking = self.reserve()
        agent.observe_action(booking)
        agent.chat("预约成功了吗？")
        self.assertIn(booking["id"], client.requests[0][0]["content"])

    def test_data_adapter_configuration_does_not_silently_fallback(self):
        with self.assertRaises(AgentError):
            create_repository(Settings(data_mode="unknown"))
        with self.assertRaises(AgentError):
            create_repository(Settings(data_mode="http"))
        adapter = create_repository(Settings(data_mode="http", library_api_base="https://library.example.invalid", library_api_token="TEST-NOT-REAL"))
        self.assertIsInstance(adapter, HTTPDataRepository)

    def test_csv_cli_respects_configured_database_path(self):
        import demo
        path = Path(self.temp.name) / "import.csv"
        path.write_text("id,title,author,source\nIMPORT-001,测试导入到指定库,编者,测试来源\n", encoding="utf-8")
        db = Path(self.temp.name) / "configured.sqlite3"
        with patch("demo.Settings.load", return_value=Settings(database_path=str(db))), patch("sys.argv", ["demo.py", "--import-books", str(path)]), patch("sys.stdout", new_callable=io.StringIO):
            demo.main()
        self.assertTrue(db.exists())
        repository = LibraryRepository(db)
        self.assertEqual(repository.locate_book("IMPORT-001")["title"], "测试导入到指定库")

    def test_http_contract_requires_local_demo_token(self):
        app = Application(self.repo, Settings(), FakeClient([response("你好，这是演示原型。")]))
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(app))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with request.urlopen(base + "/health", timeout=3) as res:
                self.assertFalse(json.load(res)["official_system_connected"])
            with self.assertRaises(error.HTTPError) as missing:
                request.urlopen(base + "/api/tools", timeout=3)
            self.assertEqual(missing.exception.code, 401)
            req = request.Request(base + "/api/chat", json.dumps({"message": "你好"}).encode(), {
                "Content-Type": "application/json", "X-Demo-Token": app.token,
            })
            with request.urlopen(req, timeout=3) as res:
                self.assertIn("session_id", json.load(res))
            # Reader pages receive only a short-lived LOCAL API token, never provider credentials.
            with request.urlopen(base + "/", timeout=3) as res:
                html = res.read().decode("utf-8")
                self.assertIn("江苏大学智能图书馆", html)
                self.assertNotIn("__APP_CONFIG_JSON__", html)
                self.assertNotIn(app.staff_token, html)
            with request.urlopen(base + "/staff", timeout=3) as res:
                self.assertEqual(res.geturl(), base + "/?staff_login=1")
                self.assertNotIn(app.staff_token, res.read().decode("utf-8"))
            staff_req = request.Request(base + "/api/staff/tickets", headers={"X-Demo-Token": app.token})
            with self.assertRaises(error.HTTPError) as forbidden:
                request.urlopen(staff_req, timeout=3)
            self.assertEqual(forbidden.exception.code, 403)
            private = request.Request(base + "/%2e%2e/agent_backend/.env")
            with self.assertRaises(error.HTTPError) as missing_private:
                request.urlopen(private, timeout=3)
            self.assertEqual(missing_private.exception.code, 404)
        finally:
            server.shutdown()
            thread.join(timeout=3)
            server.server_close()


class ProviderTests(unittest.TestCase):
    def test_missing_key_and_https_validation(self):
        with self.assertRaisesRegex(AgentError, "尚未配置"):
            DeepSeekClient(Settings()).complete([], [])
        with self.assertRaisesRegex(AgentError, "HTTPS"):
            DeepSeekClient(Settings(api_key="test", base_url="http://invalid.test")).complete([], [])

    def test_official_request_shape_without_real_network(self):
        raw = json.dumps(response("测试响应")).encode()
        stream = io.BytesIO(raw)
        with patch("model_client.request.urlopen", return_value=stream) as mocked:
            result = DeepSeekClient(Settings(api_key="TEST-KEY-NOT-REAL")).complete([{"role": "user", "content": "你好"}], [])
            req = mocked.call_args.args[0]
            payload = json.loads(req.data)
            self.assertEqual(req.full_url, "https://api.deepseek.com/chat/completions")
            self.assertEqual(payload["thinking"], {"type": "disabled"})
            self.assertEqual(payload["tool_choice"], "auto")
            self.assertEqual(result["choices"][0]["message"]["content"], "测试响应")


if __name__ == "__main__":
    unittest.main()

