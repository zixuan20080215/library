"""Smoke-test the no-key dialogue against campus CSV data using a temporary database."""
from datetime import datetime
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "agent_backend"))

from demo_agent import DemoAgent  # noqa: E402
from repository import LibraryRepository  # noqa: E402
from tools import LibraryTools  # noqa: E402


def main():
    now = datetime.fromisoformat("2026-10-29T14:00:00+08:00").timestamp()
    with tempfile.TemporaryDirectory(prefix="library_dialogue_smoke_") as directory:
        repo = LibraryRepository(Path(directory) / "smoke.sqlite3", clock=lambda: now,
                                 campus_directory=ROOT / "江苏大学图书馆资料")
        demo = DemoAgent(LibraryTools(repo))
        session = None
        prompts = [
            "你好", "你能做什么？", "图书馆几点开门？", "怎么续借？", "怎么预约座位？",
            "有哪些阅览室？", "这个网站有什么功能？", "签到和退座有哪些规则？", "你是大模型吗？",
            "找人工智能与教育的入门书", "第一本在哪里？", "明天下午2点到4点，找电子阅览室（2楼）的座位",
            "预约第一个", "怎么报修？", "反馈3楼北区的插座坏了，需要检查", "我的预约", "讲个笑话", "谢谢",
        ]
        for prompt in prompts:
            result = demo.chat(prompt, session)
            session = result["session_id"]
            tools = ",".join(item["tool"] for item in result["tool_results"]) or "-"
            print(f"\n问：{prompt}\n答：{result['answer']}\n工具：{tools}；待确认：{len(result['pending_actions'])}")
        assert repo.overview("demo-reader")["books_total"] == 247
        assert repo.overview("demo-reader")["seats_total"] == 2161
        print("\n冒烟测试完成：247 条书目、2,161 个座位；所有写入均仅发生于临时数据库。")


if __name__ == "__main__":
    main()
