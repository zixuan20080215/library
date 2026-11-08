"""Allowlisted business functions with local argument validation."""
import json

from model_client import AgentError


def string(description, **extra):
    return {"type": "string", "description": description, **extra}


LIMIT = {"type": "integer", "minimum": 1, "maximum": 5, "description": "最多返回5条候选"}
TIME = string("带时区的ISO时间，如2026-10-30T14:00:00+08:00；时间不清楚时先追问")
CATEGORIES = ["设备故障", "环境问题", "秩序反馈", "图书问题", "服务建议", "其他"]


def definition(name, description, properties, required):
    return {"type": "function", "function": {
        "name": name, "description": description,
        "parameters": {"type": "object", "properties": properties, "required": required, "additionalProperties": False},
    }}


TOOLS = [
    definition("get_institution_profile", "查询江苏大学或江苏大学图书馆的官方简介摘编，包含来源与资料日期；全馆统计不等于本站导入数量。", {
        "profile_id": string("学校选university，图书馆选library", enum=["university", "library"]),
    }, ["profile_id"]),
    definition("search_books", "检索已导入书目。将读者需求转为简洁主题词，可包含同义词；返回候选及来源，不返回整库。", {
        "query": string("主题词、书名、作者、ISBN、出版社或检索词；最多1000字符"), "limit": LIMIT,
    }, ["query"]),
    definition("locate_book", "查询检索结果中某本书的位置；不能自行推断书架。", {
        "book_id": string("已查询到的书目ID"),
    }, ["book_id"]),
    definition("search_rules", "查询演示原型规则；演示规则不是学校官方规定。", {
        "query": string("需要查询的规则，如签到、预约、反馈"),
    }, ["query"]),
    definition("search_seats", "按时段及必要条件查询本站可预约座位。设施未知或无匹配时先说明。", {
        "start_at": TIME, "end_at": TIME, "limit": LIMIT,
        "has_power": {"type": "boolean", "description": "是否要求插座"},
        "near_window": {"type": "boolean", "description": "是否要求靠窗"},
        "quiet_zone": {"type": "boolean", "description": "是否要求人工标注的安静区域"},
        "floor": {"type": "integer", "minimum": -1, "maximum": 20},
        "zone": string("按阅览室名称筛选，例如社科阅览室A区"),
    }, ["start_at", "end_at"]),
    definition("get_my_booking", "读取当前演示读者自己的预约记录。", {
        "booking_id": string("预约编号"),
    }, ["booking_id"]),
    definition("get_my_feedback", "读取当前演示读者自己的反馈处理状态。", {
        "ticket_id": string("反馈编号"),
    }, ["ticket_id"]),
    definition("prepare_booking", "仅生成预约确认卡，不会立即预约。需已明确座位与时段，读者之后在网页确认。", {
        "seat_id": string("查询到的座位ID"), "start_at": TIME, "end_at": TIME,
    }, ["seat_id", "start_at", "end_at"]),
    definition("prepare_booking_change", "仅生成签到、取消或退座的确认卡，不会立即改变预约。", {
        "booking_id": string("当前读者的预约编号"),
        "operation": string("要进行的操作", enum=["check_in", "cancel", "release"]),
    }, ["booking_id", "operation"]),
    definition("prepare_feedback", "整理反馈并生成待确认卡，不会提交至学校。信息不足时先追问。", {
        "category": string("问题类型", enum=CATEGORIES),
        "location": string("读者确认的楼层、区域或座位"),
        "description": string("保留事实的信息摘要，不推断责任人或处理结果"),
    }, ["category", "location", "description"]),
]

SCHEMAS = {t["function"]["name"]: t["function"]["parameters"] for t in TOOLS}


def validate(name, arguments):
    schema = SCHEMAS.get(name)
    if schema is None:
        raise AgentError("工具不在允许列表中。")
    if not isinstance(arguments, str) or len(arguments) > 8000:
        raise AgentError("工具参数必须是长度受限的JSON字符串。")
    try:
        args = json.loads(arguments)
    except ValueError as exc:
        raise AgentError("工具参数不是有效JSON，请重新组织参数。") from exc
    if not isinstance(args, dict):
        raise AgentError("工具参数应为JSON对象。")
    if set(args) - set(schema["properties"]) or set(schema["required"]) - set(args):
        raise AgentError("工具参数存在未知字段或缺少必要字段。")
    for key, value in args.items():
        spec = schema["properties"][key]
        expected = {"string": str, "integer": int, "boolean": bool}[spec["type"]]
        if type(value) is not expected:
            raise AgentError(f"参数{key}类型错误。")
        if isinstance(value, str) and (not value.strip() or len(value) > 1000):
            raise AgentError(f"参数{key}应为1至1000字符。")
        if "enum" in spec and value not in spec["enum"]:
            raise AgentError(f"参数{key}不在允许值中。")
        if expected is int and not spec.get("minimum", -1000) <= value <= spec.get("maximum", 1000):
            raise AgentError(f"参数{key}超出范围。")
    return args


class LibraryTools:
    def __init__(self, repository, owner="demo-reader"):
        self.repository = repository
        self.owner = owner  # Bound by the backend, never selected by the model.

    def call(self, name, arguments):
        try:
            args = validate(name, arguments)
            repo = self.repository
            if name == "get_institution_profile":
                return repo.get_institution_profile(**args)
            if name == "search_books":
                return repo.search_books(**args)
            if name == "locate_book":
                return repo.locate_book(**args)
            if name == "search_rules":
                rules = [
                    {"id": "DEMO-R1", "text": "演示预约单次最多8小时；以确认时冲突检查结果为准。"},
                    {"id": "DEMO-R2", "text": "演示签到允许开始前15分钟至开始后15分钟；未签到超时释放，使用到期自动结束。"},
                    {"id": "DEMO-R3", "text": "演示反馈仅写入原型数据库，不表示图书馆已受理；处理进度从数据库读取。"},
                ]
                from repository import indexed_terms
                terms = set(indexed_terms(args["query"]))
                scored = [(len(terms & set(indexed_terms(r["text"]))), r) for r in rules]
                return {"items": [r for score, r in sorted(scored, key=lambda pair: -pair[0]) if score > 0],
                        "is_demo": True, "source": "自拟原型规则；不是江大规定"}
            if name == "search_seats":
                return repo.search_seats(**args)
            if name == "get_my_booking":
                return repo.get_booking(self.owner, **args)
            if name == "get_my_feedback":
                return repo.get_feedback(self.owner, **args)
            if name == "prepare_booking":
                return repo.prepare_action(self.owner, "reserve", args)
            if name == "prepare_booking_change":
                return repo.prepare_action(self.owner, args["operation"], {"booking_id": args["booking_id"]})
            return repo.prepare_action(self.owner, "feedback", args)
        except AgentError as exc:
            return {"error": str(exc), "executed": False}


def bounded_result(result, maximum=9000):
    """Keep tool output structured, trimming candidate lists before model transmission."""
    result = dict(result)
    if isinstance(result.get("items"), list):
        result["items"] = list(result["items"])
        while result["items"] and len(json.dumps(result, ensure_ascii=False)) > maximum:
            result["items"].pop()
            result["truncated"] = True
    if len(json.dumps(result, ensure_ascii=False)) > maximum:
        return {"error": "查询结果过长，请缩小查询范围。", "executed": False}
    return result

