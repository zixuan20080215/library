"""Run offline business workflows, or explicitly call DeepSeek with --ask."""
import argparse
from datetime import datetime, timedelta
import json
from pathlib import Path
import tempfile

from agent import LibraryAgent
from data_gateway import create_repository
from model_client import AgentError, DeepSeekClient, Settings
from repository import LibraryRepository, LOCAL_TZ
from tools import LibraryTools


def offline_demo():
    with tempfile.TemporaryDirectory(prefix="library_agent_demo_") as folder:
        repo = LibraryRepository(Path(folder) / "demo.sqlite3")
        tools = LibraryTools(repo)
        call = lambda name, args: tools.call(name, json.dumps(args, ensure_ascii=False))
        start = datetime.now(LOCAL_TZ).replace(microsecond=0) + timedelta(minutes=5)
        end = start + timedelta(hours=2)
        times = {"start_at": start.isoformat(), "end_at": end.isoformat()}
        books = call("search_books", {"query": "人工智能 教育 入门", "limit": 3})
        seats = call("search_seats", {**times, "has_power": True, "quiet_zone": True, "limit": 3})
        proposal = call("prepare_booking", {**times, "seat_id": seats["items"][0]["id"]})
        # This script is the explicit confirmation actor, not the model.
        receipt = repo.confirm_action(tools.owner, proposal["action_id"])
        checkin = call("prepare_booking_change", {"booking_id": receipt["id"], "operation": "check_in"})
        checked_in = repo.confirm_action(tools.owner, checkin["action_id"])
        feedback = call("prepare_feedback", {"category": "设备故障", "location": "演示3楼北区 " + receipt["seat_id"], "description": "演示问题：插座无法供电。"})
        ticket = repo.confirm_action(tools.owner, feedback["action_id"])
        return {
            "mode": "offline_business_demo_not_model_reasoning",
            "note": "没有调用DeepSeek，没有扣费；所有书目、座位、预约和反馈均为演示。",
            "books": books, "location": call("locate_book", {"book_id": books["items"][0]["id"]}),
            "seats": seats, "reservation_preview": proposal, "reservation_receipt": receipt,
            "checked_in": checked_in, "feedback_receipt": ticket,
            "feedback_status": call("get_my_feedback", {"ticket_id": ticket["id"]}),
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ask", help="明确发起一次真实模型对话，需要先配置.env；会产生API费用")
    parser.add_argument("--output", help="将结果另存为UTF-8 JSON")
    parser.add_argument("--import-books", help="导入UTF-8 CSV书目，自动建立本地检索索引")
    args = parser.parse_args()
    try:
        if args.import_books:
            settings = Settings.load()
            if settings.data_mode != "demo":
                raise AgentError("CSV导入用于本地数据库；外部数据模式请通过相应数据服务导入。")
            result = create_repository(settings).import_books(args.import_books)
        elif args.ask:
            settings = Settings.load()
            repo = create_repository(settings)
            result = LibraryAgent(DeepSeekClient(settings), LibraryTools(repo), settings).chat(args.ask)
        else:
            result = offline_demo()
        text = json.dumps(result, ensure_ascii=False, indent=2)
        if args.output:
            Path(args.output).write_text(text + "\n", encoding="utf-8")
        print(text)
    except AgentError as exc:
        parser.exit(1, str(exc) + "\n")


if __name__ == "__main__":
    main()

