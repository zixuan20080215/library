"""Source-dated public introductions, shared by SQLite seeding and the offline build."""
import json
from pathlib import Path
import re
import unicodedata

from model_client import AgentError

SOURCE = Path(__file__).resolve().parents[1] / "江苏大学图书馆资料" / "学校与图书馆简介.json"
PROFILE_EXCLUSION = (
    r"《|》|ISBN|(?:找|查|搜|推荐|有没有|有无).*(?:书(?!馆)|读物)|本站|本网站|演示|原型|"
    r"预约|选座|签到|退座|反馈|报修|投诉|坏了|故障|损坏|开放时间|开馆时间|闭馆时间|几点|"
    r"怎么|如何|规则|续借|借书|还书|借阅期限|借阅册数|电子资源|打印|复印|Wi-?Fi|联系电话|联系方式|(?<!江苏)大学(?!生)"
)
PROFILE_QUERIES = [
    {"id": "library", "patterns": [
        r"(?:简介|概况|介绍|说说|了解).*(?:江苏大学图书馆|江大图书馆|图书馆|本馆)",
        r"(?:江苏大学图书馆|江大图书馆|图书馆|本馆).*(?:简介|概况|介绍|特色资源)",
        r"^(?:那|那么)?(?:江苏大学图书馆|江大图书馆|图书馆|本馆)(?:呢)?[？?。！!]*$",
    ]},
    {"id": "university", "exclude": r"图书馆|本馆", "patterns": [
        r"(?:简介|概况|介绍|说说|了解).*(?:江苏大学|江大|学校|本校)",
        r"(?:江苏大学|江大|学校|本校).*(?:简介|概况|介绍|校训|校址|办学特色|合并|成立)",
        r"^(?:那|那么)?(?:江苏大学|江大|学校|本校)(?:呢)?[？?。！!]*$",
    ]},
]


def load_profiles():
    """Keep failures explicit so a missing release asset cannot silently become invented facts."""
    try:
        entries = json.loads(SOURCE.read_text(encoding="utf-8"))
        fields = {"id", "title", "content", "source_name", "source_url", "source_updated_at", "verified_at", "note"}
        if not isinstance(entries, list) or {item["id"] for item in entries} != {"university", "library"} or len(entries) != 2:
            raise ValueError
        for item in entries:
            if set(item) != fields or any(not isinstance(value, str) or not value.strip() for value in item.values()):
                raise ValueError
            if not re.fullmatch(r"https://(?:www|lib)\.ujs\.edu\.cn/[^\s]+", item["source_url"]):
                raise ValueError
        return entries
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise AgentError("学校与图书馆简介资料缺失或格式错误，请检查学校与图书馆简介.json。") from exc


def profile_request(text):
    text = unicodedata.normalize("NFKC", text.strip())
    if re.search(PROFILE_EXCLUSION, text, re.I):
        return None
    for entry in PROFILE_QUERIES:
        if entry.get("exclude") and re.search(entry["exclude"], text):
            continue
        if any(re.search(pattern, text) for pattern in entry["patterns"]):
            return entry["id"]
    return None


def format_profile(record):
    return (f"{record['title']}\n{record['content']}\n\n{record['note']}\n"
            f"来源：{record['source_name']}；原文更新：{record['source_updated_at']}；核验：{record['verified_at']}。")


def bundled_profile(profile_id):
    """Public local reference content remains local even with an external business adapter."""
    for entry in load_profiles():
        if entry["id"] == profile_id:
            return entry
    raise AgentError("未收录该机构简介。")
