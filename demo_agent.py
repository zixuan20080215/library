"""Transparent rule-based demo with curated knowledge and local business tools."""
from datetime import datetime, timedelta
import json
import re
import uuid

from demo_knowledge import match_knowledge
from institution_profiles import profile_request, format_profile
from model_client import AgentError
from repository import LOCAL_TZ


TIME_RE = re.compile(
    r"(?:(上午|早上|中午|下午|晚上|凌晨)\s*)?(\d{1,2})"
    r"(?:\s*[:：]\s*(\d{1,2})|\s*[点时]\s*(半|\d{1,2})?\s*分?)"
)
BOOKING_ID_RE = re.compile(r"(?<![A-Z0-9])BK-[0-9a-f]{6,32}(?![A-Z0-9])", re.I)
TICKET_ID_RE = re.compile(r"(?<![A-Z0-9])FB-[0-9a-f]{6,32}(?![A-Z0-9])", re.I)
LOCATION_RE = re.compile(
    r"(?:[1-6一二三四五六]\s*楼|DEMO-S\d{2}|\d{1,4}号(?:座位)?)[^，。；\n]{0,40}", re.I
)
STATUS_LABELS = {
    "reserved": "待签到", "checked_in": "使用中", "completed": "已完成", "cancelled": "已取消",
    "expired": "已过期", "pending": "待受理", "processing": "处理中", "replied": "已回复", "closed": "已办结",
}
TOPICS = {
    "人工智能": "人工智能", "机器学习": "机器学习", "深度学习": "深度学习", "算法": "算法",
    "教育": "教育", "教学": "教育", "心理": "心理学", "学习方法": "学习方法", "时间管理": "时间管理",
    "研究方法": "研究方法", "校园治理": "校园治理", "文学": "文学", "小说": "小说", "散文": "散文",
    "诗歌": "诗歌", "历史": "历史", "哲学": "哲学", "计算机": "计算机", "编程": "编程",
    "程序设计": "程序设计", "python": "Python", "英语": "英语", "外语": "外语", "考研": "考研",
    "科普": "科普", "科学": "科学", "经济": "经济", "管理": "管理", "法律": "法律", "法学": "法学",
    "医学": "医学", "艺术": "艺术", "设计": "设计", "传记": "传记", "育儿": "育儿",
}


def has_any(text, words):
    return any(word in text for word in words)


def ordinal_index(text):
    match = re.search(r"第\s*([一二三四五1-5])\s*(?:个|本|条|项)?|([一二三四五1-5])\s*(?:个|本|条|项)", text)
    if not match:
        return None
    value = match[1] or match[2]
    return ("一二三四五".index(value) if value in "一二三四五" else int(value) - 1)


def parse_times(text, now):
    """Parse two local times such as 14:00 or 下午2点半; return None when incomplete."""
    normalized = text.replace("今晚", "今天晚上").replace("明晚", "明天晚上")
    matches = list(TIME_RE.finditer(normalized))
    if len(matches) < 2:
        return None
    day = datetime.fromtimestamp(now, LOCAL_TZ).date()
    if "后天" in normalized:
        day += timedelta(days=2)
    elif "明天" in normalized:
        day += timedelta(days=1)
    values = []
    first_period = matches[0][1]
    for index, match in enumerate(matches[:2]):
        period, hour_text, colon_minute, hour_minute = match.groups()
        period = period or (first_period if index else None)
        hour, minute = int(hour_text), colon_minute or hour_minute or "0"
        minute = 30 if minute == "半" else int(minute)
        if period in ("下午", "晚上") and hour < 12:
            hour += 12
        elif period == "中午" and hour < 6:
            hour += 12
        elif period in ("凌晨", "上午", "早上") and hour == 12:
            hour = 0
        if hour > 23 or minute > 59:
            raise ValueError
        values.append(datetime(day.year, day.month, day.day, hour, minute, tzinfo=LOCAL_TZ))
    if values[1] <= values[0]:
        raise ValueError
    return {"start_at": values[0].isoformat(), "end_at": values[1].isoformat()}


class DemoAgent:
    def __init__(self, tools):
        self.tools = tools
        self.sessions = {}

    @staticmethod
    def _small_talk(text):
        compact = re.sub(r"[\s，。！？!?~～、]", "", text.casefold())
        if compact in {"你好", "您好", "你好呀", "嗨", "哈喽", "hi", "hello", "在吗", "早上好", "下午好", "晚上好"}:
            return "你好！我可以帮你查书目、找座位、整理反馈，也能回答本站使用和常见图书馆服务问题。直接说需求就好。"
        if compact in {"谢谢", "谢谢你", "谢谢您", "感谢", "多谢", "辛苦了", "辛苦啦"}:
            return "不客气！还需要查书、选座或看预约反馈进度，随时告诉我。"
        if compact in {"再见", "拜拜", "bye", "byebye", "下次见"}:
            return "再见！祝你阅读和学习顺利。已经确认的预约与反馈仍可在“我的服务”查看。"
        if compact in {"你是谁", "你叫什么", "你能做什么", "你会什么", "帮助", "help", "功能介绍", "你能干嘛"}:
            return ("我是本站的 AI 馆员。当前无 Key 时由本地规则引擎工作，可以：① 按书名、ISBN、作者或主题查书；"
                    "② 按时段、楼层和偏好查座并生成预约确认卡；③ 整理馆内反馈；④ 查询本站预约与反馈；"
                    "⑤ 回答座位规则、网站使用和常见服务问题。你可以从任意一项开始。")
        if compact in {"讲个笑话", "讲笑话", "来个笑话", "说个笑话"}:
            return "有本书一直不愿离开书架，因为它觉得自己的内容太“有分量”了。笑过之后，也可以告诉我你想找什么主题的书。"
        if compact in {"你真聪明", "你好聪明", "你真厉害", "你好厉害", "真棒", "太棒了"}:
            return "谢谢鼓励！我会继续用本站资料帮你查清楚；不确定的内容也会明确说明，不会假装知道。"
        return None

    def _dynamic_answer(self, kind):
        repo = self.tools.repository
        if kind == "rooms":
            floors = {}
            for row in repo.seat_rooms():
                name = re.sub(r"\(\d+楼\)$", "", row["zone"])
                floors.setdefault(row["floor"], []).append(name)
            details = "；".join(f"{floor}楼：" + "、".join(names) for floor, names in sorted(floors.items()))
            return f"本站已导入 {sum(len(v) for v in floors.values())} 个阅览室。{details}。打开“空间与选座”可查看平面图，也可以直接告诉我时段和阅览室。"
        if kind == "overview":
            data = repo.overview(self.tools.owner)
            return (f"本站目前收录 {data['books_total']} 条书目和 {data['seats_total']} 个座位，提供馆藏检索、"
                    f"平面图选座、预约签到退座、事务反馈和馆员演示办理。当前演示记录中有 {data['reserved']} 条待签到预约、"
                    f"{data['in_use']} 条使用中预约和 {data['pending_tickets']} 条待处理反馈；这些统计仅来自本地原型数据库。")
        if kind == "my_records":
            data = repo.my_services(self.tools.owner)
            bookings, tickets = data["bookings"], data["tickets"]
            if not bookings and not tickets:
                return "当前演示读者还没有预约或反馈记录。你可以先让我查一个未来时段的座位，或整理一条馆内问题反馈。"
            parts = []
            if bookings:
                latest = bookings[0]
                active = sum(item["status"] in ("reserved", "checked_in") for item in bookings)
                parts.append(f"共有 {len(bookings)} 条预约（进行中 {active} 条），最近一条为 {latest['id']}，"
                             f"{latest['zone']}座位{latest['seat_number']}，状态{STATUS_LABELS.get(latest['status'], latest['status'])}")
            if tickets:
                latest = tickets[0]
                parts.append(f"共有 {len(tickets)} 条反馈，最近一条为 {latest['id']}，状态{STATUS_LABELS.get(latest['status'], latest['status'])}")
            return "；".join(parts) + "。打开“我的服务”可查看完整记录；把 BK- 或 FB- 编号发给我也能查询。"
        return ""

    def chat(self, message, session_id=None):
        if not isinstance(message, str) or not message.strip() or len(message) > 4000:
            raise AgentError("请输入1至4000字符的需求。")
        now = self.tools.repository.clock()
        self.sessions = {k: v for k, v in self.sessions.items() if now - v.get("updated", now) < 1800}
        if session_id and session_id not in self.sessions:
            raise AgentError("演示会话已过期，请新建对话。")
        session_id = session_id or uuid.uuid4().hex
        if len(self.sessions) >= 32:
            self.sessions.pop(next(iter(self.sessions)))
        context = self.sessions.setdefault(session_id, {})
        context["updated"] = now
        trace, pending = [], []

        def call(name, args):
            result = self.tools.call(name, json.dumps(args, ensure_ascii=False))
            trace.append({"tool": name, "result": result})
            if result.get("requires_confirmation"):
                pending.append(result)
            return result

        text = message.strip()
        folded = text.casefold()
        quoted_title = re.search(r"《([^》]+)》", text)
        isbn = re.search(r"(?<!\d)97[89](?:[-\s]?\d){10}(?!\d)", text)
        answer = self._small_talk(text)
        profile_id = profile_request(text)
        if answer is None and profile_id:
            result = call("get_institution_profile", {"profile_id": profile_id})
            answer = result.get("error") or format_profile(result)
            context["intent"] = "profile"

        # A specific record or a pending-seat follow-up takes priority over general Q&A.
        booking_id = BOOKING_ID_RE.search(text)
        ticket_id = TICKET_ID_RE.search(text)
        booking_value = f"BK-{booking_id[0].split('-', 1)[1].lower()}" if booking_id else ""
        ticket_value = f"FB-{ticket_id[0].split('-', 1)[1].lower()}" if ticket_id else ""
        if answer is None and booking_id:
            operation = next((op for word, op in (("取消", "cancel"), ("签到", "check_in"), ("退座", "release"), ("签退", "release")) if word in text), None)
            if operation:
                result = call("prepare_booking_change", {"booking_id": booking_value, "operation": operation})
                answer = result.get("error") or "已生成预约操作确认卡。请核对记录，确认后才会改变状态。"
            else:
                result = call("get_my_booking", {"booking_id": booking_value})
                answer = result.get("error") or f"已查到预约 {booking_value}，当前状态为{STATUS_LABELS.get(result['status'], result['status'])}。"
        elif answer is None and ticket_id:
            result = call("get_my_feedback", {"ticket_id": ticket_value})
            answer = result.get("error") or f"已查到反馈 {ticket_value}，当前状态为{STATUS_LABELS.get(result['status'], result['status'])}。"

        if answer is None and context.get("times") and len(TIME_RE.findall(text)) < 2:
            selected = ordinal_index(text)
            selection_only = re.fullmatch(r"(?:第\s*)?[一二三四五1-5]\s*个[，。！？!?\s]*", text)
            if selected is not None and (has_any(text, ("预约", "选", "就", "订", "约", "座位")) or selection_only):
                seats = context.get("seats", [])
                if 0 <= selected < len(seats):
                    result = call("prepare_booking", {"seat_id": seats[selected]["id"], **context["times"]})
                    answer = result.get("error") or f"已为第{selected + 1}个候选座位生成预约确认卡。确认后才会完成预约。"
                else:
                    answer = f"当前只有{len(seats)}个候选座位，请选择已有序号，或换个条件重新查询。" if seats else "请先提供使用时段，我会查询可选座位。"

        # Continue a book search with a grounded location lookup instead of starting over.
        if answer is None and context.get("books") and not quoted_title and not isbn and has_any(text, ("在哪里", "在哪儿", "位置", "哪楼", "几楼", "书架", "索书号")):
            selected = ordinal_index(text) or 0
            books = context["books"]
            if selected < len(books):
                result = call("locate_book", {"book_id": books[selected]["id"]})
                answer = result.get("error") or "已按刚才的书目记录查询位置。可借状态和未提供的位置字段仍需通过学校正式馆藏目录确认。"
            else:
                answer = "刚才的结果中没有这一本，请按结果序号选择。"

        # Concrete seat search: two times plus a seat/room/preference expression.
        times = None
        if answer is None:
            try:
                times = parse_times(text, now)
            except ValueError:
                answer = "时间格式或先后顺序不正确。可以试试“明天14:00到16:00”或“明天下午2点到4点”。"
        seat_search = times and has_any(text, ("座", "插座", "充电", "靠窗", "安静", "阅览室", "自习", "位置"))
        if answer is None and seat_search:
            context["intent"] = "seats"
            combined = text + " " + context.pop("preferences", "")
            filters = {key: True for words, key in (
                (("插座", "电源", "充电"), "has_power"), (("靠窗", "窗边"), "near_window"),
                (("安静", "静音"), "quiet_zone"),
            ) if has_any(combined, words)}
            floor = re.search(r"(?<!\d)(\d{1,2}|[一二三四五六])\s*[楼层]", combined)
            if floor:
                value = floor[1]
                filters["floor"] = int(value) if value.isdigit() else "一二三四五六".index(value) + 1
            list_rooms = getattr(self.tools.repository, "seat_rooms", None)
            if list_rooms:
                names = {re.sub(r"\(\d+楼\)$", "", row["zone"]) for row in list_rooms()}
                room = max((name for name in names if name.casefold() in combined.casefold()), key=len, default="")
                if room:
                    filters["zone"] = room
            result = call("search_seats", {**times, **filters})
            context["seats"], context["times"] = result.get("items", []), times
            if result.get("error"):
                answer = result["error"]
            elif result["items"]:
                answer = (f"找到{len(result['items'])}个本站可预约座位。时间为{times['start_at'][5:16].replace('T', ' ')}至{times['end_at'][11:16]}。"
                          "可以在结果卡中选择，也可以说“预约第一个”或“预约第二个”。")
            elif result.get("inventory_source") == "library_files" and any(key in filters for key in ("has_power", "near_window", "quiet_zone")):
                answer = "导入的座位表只提供阅览室和座位号，设施信息待补充。可以去掉插座、靠窗等条件，改按楼层或阅览室选座。"
            else:
                answer = "当前条件下没有匹配座位。可以调整时段、楼层或阅览室再试。"

        # A concrete problem report becomes a confirmation card, never an immediate write.
        feedback_words = ("坏", "故障", "报修", "反馈", "反映", "投诉", "不能用", "无法使用", "失灵", "漏水", "不亮", "连不上", "太吵", "噪音")
        if answer is None and has_any(text, feedback_words) and not has_any(text, ("怎么", "如何", "流程", "办法")):
            match = LOCATION_RE.search(text)
            if not match:
                context["intent"] = "feedback"
                answer = "可以帮你整理反馈。请补充楼层或座位，以及具体遇到的问题；也可以打开“事务反馈”页面填写。"
            else:
                if has_any(text, ("吵", "噪音", "占座", "打闹")):
                    category = "秩序反馈"
                elif has_any(text, ("卫生", "异味", "漏水", "太冷", "太热", "温度")):
                    category = "环境问题"
                elif "书" in text:
                    category = "图书问题"
                elif has_any(text, ("插座", "灯", "故障", "坏", "设备", "打印", "网络", "连不上", "桌椅")):
                    category = "设备故障"
                else:
                    category = "其他"
                result = call("prepare_feedback", {"category": category, "location": match.group(0), "description": text[:1000]})
                answer = result.get("error") or "已整理为一条待确认反馈。请核对下方信息后提交，提交后可以在“我的服务”查看进度。"
                context["intent"] = "feedback"

        if answer is None:
            entry = match_knowledge(text)
            if entry:
                answer = self._dynamic_answer(entry["dynamic"]) if entry.get("dynamic") else entry["answer"]
                context["last_knowledge"] = entry["id"]

        # Book search uses only local lexical retrieval; a vague request gets a useful prompt.
        book_words = ("书", "读", "教育", "心理", "学习", "人工智能", "研究", "作者", "文学", "小说", "历史", "哲学", "编程", "英语")
        if answer is None and (quoted_title or isbn or has_any(folded, book_words) or re.search(r"(?<![a-z])ai(?![a-z])", folded)):
            context["intent"] = "books"
            topics = []
            for word, topic in TOPICS.items():
                if word in folded and topic not in topics:
                    topics.append(topic)
            if re.search(r"(?<![a-z])ai(?![a-z])", folded) and "人工智能" not in topics:
                topics.append("人工智能")
            author = (re.search(r"作者[：:]\s*([^，。；\s]{2,16})", text)
                      or re.search(r"(?:找|查)([^，。；]{2,16}?)的书", text))
            generic = re.sub(r"[\s，。！？!?]", "", text) in {"找书", "我想找书", "我要找书", "查书", "我想看书", "我想读书"}
            if generic:
                answer = "想查哪一类？可以直接说《书名》、ISBN、作者，或“人工智能入门”“教育研究方法”“心理学”等主题。"
            else:
                query = quoted_title[1] if quoted_title else isbn[0] if isbn else author[1] if author else " ".join(topics) or text
                result = call("search_books", {"query": query, "limit": 3})
                items = result.get("items", [])
                context["books"] = items
                if items:
                    answer = f"找到{len(items)}条本地书目记录。点击结果卡可查看详情，也可以接着问“第一本在哪里”。结果按词项相关度排序，不代表实时可借状态。"
                else:
                    answer = "现有书单中没有匹配结果。可以换《书名》、作者、ISBN 或更宽的主题词重试；本站也不能据此判断学校实际馆藏。"
                    context["books"] = []

        if answer is None and has_any(text, ("座", "插座", "充电", "靠窗", "安静", "阅览室", "自习")):
            context["intent"] = "seats"
            context["preferences"] = text
            answer = "请告诉我使用时段，例如“明天14:00到16:00，找2楼的座位”，也支持“明天下午2点到4点”这样的说法。"

        if answer is None:
            context["intent"] = None
            answer = ("这条暂时超出了本地规则库。我可以直接帮你：找《书名》或作者的书；查询“明天下午2点到4点”的座位；"
                      "整理带楼层或座位的反馈；查询 BK-/FB- 记录；也可以回答“怎么预约”“如何签到”“网站数据真实吗”等问题。"
                      "开放式自由问答需要配置 DeepSeek 后由真实模型处理。")
        return {"session_id": session_id, "answer": answer, "tool_results": trace,
                "pending_actions": pending, "mode": "rule_demo", "official_system_connected": False,
                "usage": {"prompt_tokens": 0, "completion_tokens": 0}}
