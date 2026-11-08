"""Read the supplied reading-room inventory and two source book lists."""

from collections import defaultdict
import csv
import re

from model_client import AgentError


BOOK_FILES = (
    ("2025年读者荐购书单.csv", "RD"),
    ("2025年芸台购书单.csv", "YT"),
)


def _rows(path, required):
    try:
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream, strict=True)
            if not required.issubset(reader.fieldnames or []):
                raise AgentError(f"{path.name} 缺少必要字段。")
            rows = list(reader)
    except (OSError, UnicodeError, csv.Error) as exc:
        raise AgentError(f"无法读取 {path.name}，请检查资料文件。") from exc
    if not rows or any(None in row for row in rows):
        raise AgentError(f"{path.name} 没有有效数据，或行列数不匹配。")
    return rows


def _seat_rows(directory):
    rooms = defaultdict(set)
    for row in _rows(directory / "座位表.csv", {"阅览室", "座位号"}):
        room = (row["阅览室"] or "").strip()
        number = (row["座位号"] or "").strip()
        if not re.search(r"\(\d+楼\)$", room) or not re.fullmatch(r"[A-Za-z]*\d+", number):
            raise AgentError(f"座位表中的阅览室或座位号格式不正确：{room} {number}。")
        if number in rooms[room]:
            raise AgentError(f"座位表有重复编号：{room} {number}。")
        rooms[room].add(number)

    def seat_order(number):
        prefix, digits = re.fullmatch(r"([A-Za-z]*)(\d+)", number).groups()
        return prefix.upper(), int(digits), number

    seats = []
    for room, numbers in rooms.items():
        floor = int(re.search(r"\((\d+)楼\)$", room)[1])
        for index, number in enumerate(sorted(numbers, key=seat_order)):
            # CSV row order and screenshot colors provide no physical coordinates or amenities.
            # row_no and col_no are display order. The local booking system owns availability.
            seats.append((f"UJS:{room}:{number}", floor, room, number, index // 12 + 1, index % 12 + 1))
    return seats


def _book_rows(directory):
    books = []
    for filename, code in BOOK_FILES:
        serials = set()
        for row in _rows(directory / filename, {"序号", "书名", "作者", "ISBN", "出版社"}):
            serial = (row["序号"] or "").strip()
            title = (row["书名"] or "").strip()
            isbn = (row["ISBN"] or "").strip()
            if not serial.isdecimal() or not title or not isbn or int(serial) in serials:
                raise AgentError(f"{filename} 第 {serial} 项缺少书名、ISBN 或有重复序号。")
            serials.add(int(serial))
            books.append({
                "id": f"UJS-B-{code}-{int(serial):03d}",
                "title": title,
                "author": (row["作者"] or "").strip(),
                "isbn": isbn,
                "publisher": (row["出版社"] or "").strip(),
                "source": filename.removesuffix(".csv"),
                "is_demo": 0,
            })
    return books


def load_campus_data(directory):
    return _seat_rows(directory), _book_rows(directory)
