"""Local demo repository; replace this boundary with authorized school services later."""
import csv
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import re
import sqlite3
import time
import uuid

from campus_data import load_campus_data
from institution_profiles import load_profiles
from model_client import AgentError, ROOT

LOCAL_TZ = timezone(timedelta(hours=8))
BOOKING_ROWS = """
    SELECT b.*, s.seat_number, s.zone FROM bookings b
    LEFT JOIN seats s ON s.id = b.seat_id
"""


def indexed_terms(text):
    """Simple Chinese bigram lexical index, not an embedding/semantic retriever."""
    terms = set()
    for part in re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]+", text.lower()):
        if re.fullmatch(r"[a-z0-9]+", part) or len(part) <= 2:
            terms.add(part)
        else:
            terms.update(part[i:i + 2] for i in range(len(part) - 1))
    return sorted(terms)


def iso(ts):
    return datetime.fromtimestamp(ts, LOCAL_TZ).isoformat(timespec="seconds")


def isbn_key(value):
    value = re.sub(r"^ISBN(?:-1[03])?\s*[:：]?\s*", "", value.strip(), flags=re.I)
    compact = re.sub(r"[\s\-‐‑–]", "", value).upper()
    return compact if re.fullmatch(r"[0-9]{13}|[0-9]{9}[0-9X]", compact) else ""


def seat_number(seat_id):
    if seat_id.startswith("DEMO-S"):
        return seat_id.removeprefix("DEMO-S")
    return seat_id.rsplit(":", 1)[-1] if seat_id.startswith("UJS:") else seat_id


class LibraryRepository:
    """All writes use SQLite transactions; the model never receives SQL access."""
    def __init__(self, db_path=None, clock=time.time, *, campus_directory=None):
        self.path = Path(db_path) if db_path else ROOT / "data" / "library_demo.sqlite3"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        campus_data = load_campus_data(campus_directory) if campus_directory is not None else None
        with self.connect() as con:
            con.executescript("""
                CREATE TABLE IF NOT EXISTS books (
                    id TEXT PRIMARY KEY, title TEXT, author TEXT, summary TEXT,
                    subjects TEXT, call_number TEXT, floor INTEGER, zone TEXT,
                    shelf_id TEXT, source TEXT, is_demo INTEGER, updated_at TEXT
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS book_index USING fts5(book_id UNINDEXED, terms);
                CREATE TABLE IF NOT EXISTS seats (
                    id TEXT PRIMARY KEY, floor INTEGER, zone TEXT, has_power INTEGER,
                    near_window INTEGER, quiet_zone INTEGER, row_no INTEGER, col_no INTEGER
                );
                CREATE TABLE IF NOT EXISTS bookings (
                    id TEXT PRIMARY KEY, owner TEXT, seat_id TEXT, start_ts INTEGER,
                    end_ts INTEGER, status TEXT
                );
                CREATE INDEX IF NOT EXISTS booking_window ON bookings(seat_id, status, start_ts, end_ts);
                CREATE TABLE IF NOT EXISTS tickets (
                    id TEXT PRIMARY KEY, owner TEXT, category TEXT, location TEXT,
                    description TEXT, status TEXT, created_at TEXT
                );
                CREATE TABLE IF NOT EXISTS actions (
                    id TEXT PRIMARY KEY, owner TEXT, kind TEXT, payload TEXT,
                    expires_ts INTEGER, result TEXT
                );
                CREATE TABLE IF NOT EXISTS ticket_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id TEXT,
                    status TEXT, actor TEXT, note TEXT, created_at TEXT
                );
                CREATE TABLE IF NOT EXISTS institution_profiles (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
                    source_name TEXT NOT NULL, source_url TEXT NOT NULL,
                    source_updated_at TEXT NOT NULL, verified_at TEXT NOT NULL, note TEXT NOT NULL
                );
            """)
            con.execute("BEGIN IMMEDIATE")
            migrations = {
                "books": {"isbn": "TEXT NOT NULL DEFAULT ''", "publisher": "TEXT NOT NULL DEFAULT ''"},
                "seats": {"disabled": "INTEGER NOT NULL DEFAULT 0", "seat_number": "TEXT NOT NULL DEFAULT ''"},
                "tickets": {"reply": "TEXT NOT NULL DEFAULT ''", "updated_at": "TEXT NOT NULL DEFAULT ''"},
            }
            for table, fields in migrations.items():
                existing = {row["name"] for row in con.execute("PRAGMA table_info(" + table + ")")}
                for column, ddl in fields.items():
                    if column not in existing:
                        con.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + ddl)
            self.campus_inventory = campus_data is not None or con.execute(
                "SELECT 1 FROM seats WHERE id GLOB 'UJS:*' LIMIT 1"
            ).fetchone() is not None
            if campus_data is not None:
                self._import_campus_data(con, *campus_data)
            elif not self.campus_inventory:
                self._seed_demo(con)
            for profile in load_profiles():
                con.execute("""
                    INSERT INTO institution_profiles
                        (id,title,content,source_name,source_url,source_updated_at,verified_at,note)
                    VALUES (:id,:title,:content,:source_name,:source_url,:source_updated_at,:verified_at,:note)
                    ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content,
                        source_name=excluded.source_name, source_url=excluded.source_url,
                        source_updated_at=excluded.source_updated_at, verified_at=excluded.verified_at,
                        note=excluded.note
                """, profile)

    def list_institution_profiles(self):
        with self.connect() as con:
            return [dict(row) for row in con.execute("SELECT * FROM institution_profiles ORDER BY id")]

    def get_institution_profile(self, profile_id):
        with self.connect() as con:
            row = con.execute("SELECT * FROM institution_profiles WHERE id=?", (profile_id,)).fetchone()
        if row is None:
            raise AgentError("未收录该机构简介。")
        return dict(row)

    def _seed_demo(self, con):
        seed = [
                ("DEMO-B01", "演示书目：人工智能与教育入门", "演示编者甲", "介绍人工智能、教育技术和课堂应用，面向本科生入门。", "人工智能|教育|入门"),
                ("DEMO-B02", "演示书目：机器学习基础", "演示编者乙", "介绍机器学习和算法基础，需一定数学知识。", "人工智能|机器学习|算法"),
                ("DEMO-B03", "演示书目：心理学导论", "演示编者丙", "介绍认知、情绪和社会心理学，适合零基础阅读。", "心理学|情绪|入门"),
                ("DEMO-B04", "演示书目：大学生学习方法", "演示编者丁", "介绍时间管理、阅读与学习策略。", "学习|大学生|时间管理"),
                ("DEMO-B05", "演示书目：校园公共事务与治理", "演示编者戊", "介绍公共服务、校园治理和读者反馈处理。", "校园治理|公共服务|管理"),
                ("DEMO-B06", "演示书目：教育研究方法", "演示编者己", "介绍教育研究设计、访谈与资料分析。", "教育|研究方法|访谈"),
        ]
        for n, (bid, title, author, summary, subjects) in enumerate(seed, 1):
            if not con.execute("SELECT 1 FROM books WHERE id=?", (bid,)).fetchone():
                self._put_book(con, {
                    "id": bid, "title": title, "author": author, "summary": summary,
                    "subjects": subjects, "call_number": f"DEMO/{n}", "floor": 3,
                    "zone": "演示3楼北区", "shelf_id": f"DEMO-SHELF-{n:02}",
                    "source": "样例书目", "is_demo": 1,
                })
        for n in range(1, 25):
            con.execute("INSERT OR IGNORE INTO seats (id,floor,zone,has_power,near_window,quiet_zone,row_no,col_no,seat_number) VALUES (?,?,?,?,?,?,?,?,?)", (
                f"DEMO-S{n:02}", 3, "演示3楼北区", int(n % 2 == 0),
                int(n <= 6), int(n <= 12), (n - 1) // 6 + 1, (n - 1) % 6 + 1, f"{n:02}",
            ))

    def _import_campus_data(self, con, seats, books):
        con.execute("DELETE FROM book_index WHERE book_id GLOB 'DEMO-B0[1-6]'")
        con.execute("DELETE FROM books WHERE id GLOB 'DEMO-B0[1-6]'")
        con.execute("DELETE FROM seats WHERE id GLOB 'DEMO-S[0-9][0-9]'")
        con.executemany("""
            INSERT INTO seats (id,floor,zone,seat_number,row_no,col_no) VALUES (?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET floor=excluded.floor, zone=excluded.zone,
                seat_number=excluded.seat_number, row_no=excluded.row_no, col_no=excluded.col_no
        """, seats)
        existing = {row["id"]: dict(row) for row in con.execute("SELECT * FROM books WHERE id GLOB 'UJS-B-*'")}
        for book in books:
            previous = existing.get(book["id"], {})
            if any(previous.get(key) != value for key, value in book.items()):
                self._put_book(con, {**previous, **book})

    @contextmanager
    def connect(self):
        con = sqlite3.connect(str(self.path), timeout=10)
        con.row_factory = sqlite3.Row
        try:
            with con:
                yield con
        finally:
            con.close()

    def _put_book(self, con, book):
        columns = ("id", "title", "author", "summary", "subjects", "call_number", "floor", "zone", "shelf_id", "source", "is_demo", "isbn", "publisher")
        values = [book.get(k) if k in ("floor", "is_demo") else (book.get(k) or "") for k in columns] + [iso(self.clock())]
        con.execute("""INSERT OR REPLACE INTO books
            (id,title,author,summary,subjects,call_number,floor,zone,shelf_id,source,is_demo,isbn,publisher,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", values)
        con.execute("DELETE FROM book_index WHERE book_id=?", (book["id"],))
        terms = indexed_terms(" ".join(str(book.get(k) or "") for k in (
            "title", "author", "summary", "subjects", "call_number", "publisher", "isbn",
        )))
        con.execute("INSERT INTO book_index VALUES (?,?)", (book["id"], " ".join(terms)))

    def import_books(self, path):
        """Stream CSV rows and update the lexical index, without calling any model."""
        count = 0
        with Path(path).open(encoding="utf-8-sig", newline="") as stream, self.connect() as con:
            reader = csv.DictReader(stream)
            required = {"id", "title", "author", "source"}
            if not required.issubset(reader.fieldnames or []):
                raise AgentError("CSV至少需要id、title、author、source四列。")
            for line_no, row in enumerate(reader, 2):
                if None in row:
                    raise AgentError(f"CSV第{line_no}行列数超过表头。")
                if any(not (row.get(k) or "").strip() for k in required):
                    raise AgentError(f"CSV第{line_no}行缺少必要字段。")
                if row["id"].startswith("DEMO-"):
                    raise AgentError("导入书目ID请勿使用保留的DEMO-前缀。")
                if any(len(value or "") > 2000 for value in row.values()):
                    raise AgentError(f"CSV第{line_no}行字段过长。")
                try:
                    row["floor"] = int(row["floor"]) if row.get("floor") else None
                    flag = row.get("is_demo", "1") or "1"
                    if flag not in ("0", "1"):
                        raise ValueError
                    row["is_demo"] = int(flag)
                except ValueError as exc:
                    raise AgentError(f"CSV第{line_no}行floor或is_demo格式错误。") from exc
                self._put_book(con, row)
                count += 1
        return {"imported": count, "live_availability_connected": False}

    def _book_result(self, row):
        result = dict(row)
        for key, value in result.items():
            if isinstance(value, str):
                result[key] = value[:500]
        result["availability"] = "unknown"
        result["is_demo"] = bool(result["is_demo"])
        result["reference"] = "book:" + result["id"]
        return result

    def search_books(self, query, limit=5):
        isbn = isbn_key(query)
        if isbn:
            with self.connect() as con:
                rows = con.execute("SELECT * FROM books WHERE upper(replace(isbn,'-',''))=? ORDER BY id LIMIT ?", (isbn, limit)).fetchall()
            return {"items": [self._book_result(row) for row in rows], "retrieval": "isbn"}
        terms = indexed_terms(query)[:32]
        if not terms:
            return {"items": [], "retrieval": "lexical_fts5", "note": "请输入主题、书名或作者。"}
        match = " OR ".join('"' + term + '"' for term in terms)
        with self.connect() as con:
            rows = con.execute("""
                SELECT b.* FROM book_index i JOIN books b ON b.id=i.book_id
                WHERE book_index MATCH ? ORDER BY bm25(book_index), b.id LIMIT ?
            """, (match, limit)).fetchall()
        return {"items": [self._book_result(r) for r in rows], "retrieval": "lexical_fts5", "note": "候选结果按词项相关度排序；不是已验证的语义推荐。"}

    def locate_book(self, book_id):
        with self.connect() as con:
            row = con.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()
        if row is None:
            raise AgentError("未查询到该书目，不能推断其位置。")
        book = self._book_result(row)
        return {k: book[k] for k in ("id", "title", "author", "isbn", "publisher", "floor", "zone", "shelf_id", "call_number", "availability", "source", "is_demo", "reference")}

    def _window(self, start_at, end_at):
        try:
            dates = [datetime.fromisoformat(s.replace("Z", "+00:00")) for s in (start_at, end_at)]
            if any(d.tzinfo is None for d in dates):
                raise ValueError
            start, end = [int(d.timestamp()) for d in dates]
        except (ValueError, TypeError, AttributeError) as exc:
            raise AgentError("时段请使用带时区的ISO时间，例如2026-10-30T14:00:00+08:00。") from exc
        if start < self.clock() - 60 or end <= start or end - start > 8 * 3600:
            raise AgentError("演示预约时段应从现在或未来开始，结束晚于开始，且不超过8小时。")
        return start, end

    def _expire(self, con):
        now = int(self.clock())
        con.execute("UPDATE bookings SET status='expired' WHERE status='reserved' AND min(start_ts+900,end_ts)<=?", (now,))
        con.execute("UPDATE bookings SET status='completed' WHERE status='checked_in' AND end_ts<=?", (now,))

    def search_seats(self, start_at, end_at, limit=5, **filters):
        start, end = self._window(start_at, end_at)
        sql = """SELECT s.* FROM seats s WHERE s.disabled=0 AND NOT EXISTS (
            SELECT 1 FROM bookings b WHERE b.seat_id=s.id
            AND b.status IN ('reserved','checked_in') AND b.start_ts<? AND b.end_ts>?
        )"""
        values = [end, start]
        for key in ("has_power", "near_window", "quiet_zone", "floor"):
            if filters.get(key) is not None:
                sql += " AND s." + key + "=?"
                values.append(int(filters[key]))
        if filters.get("zone"):
            sql += " AND instr(s.zone, ?) > 0"
            values.append(filters["zone"].strip())
        with self.connect() as con:
            self._expire(con)
            rows = con.execute(sql + " ORDER BY s.floor, s.zone, s.row_no, s.col_no LIMIT ?", values + [limit]).fetchall()
        return {"items": [self._seat_result(row) for row in rows], "start_at": iso(start), "end_at": iso(end),
                "is_demo": True, "inventory_source": "library_files" if self.campus_inventory else "sample",
                "note": "空闲表示本站所选时段可预约。插座、靠窗与安静区域字段为空时，表示资料未提供。"}

    def seat_rooms(self):
        with self.connect() as con:
            rows = con.execute("SELECT DISTINCT zone, floor FROM seats ORDER BY floor, zone").fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def _seat_result(row):
        return {**dict(row), "seat_number": row["seat_number"] or seat_number(row["id"])}

    def _booking_result(self, row):
        return {"id": row["id"], "seat_id": row["seat_id"], "start_at": iso(row["start_ts"]),
                "end_at": iso(row["end_ts"]), "status": row["status"], "is_demo": True,
                "seat_number": row["seat_number"] or seat_number(row["seat_id"]),
                "zone": row["zone"] or ("样例阅览区" if row["seat_id"].startswith("DEMO-S") else "")}

    def get_booking(self, owner, booking_id):
        with self.connect() as con:
            self._expire(con)
            row = con.execute(BOOKING_ROWS + " WHERE b.id=? AND b.owner=?", (booking_id, owner)).fetchone()
        if row is None:
            raise AgentError("未查询到当前演示读者的该预约。")
        return self._booking_result(row)

    def get_feedback(self, owner, ticket_id):
        with self.connect() as con:
            row = con.execute("SELECT id,category,location,description,status,created_at,reply,updated_at FROM tickets WHERE id=? AND owner=?", (ticket_id, owner)).fetchone()
            history = con.execute("SELECT status,actor,note,created_at FROM ticket_events WHERE ticket_id=? AND EXISTS (SELECT 1 FROM tickets WHERE id=? AND owner=?) ORDER BY id", (ticket_id, ticket_id, owner)).fetchall()
        if row is None:
            raise AgentError("未查询到当前演示读者的该反馈。")
        return {**dict(row), "history": [dict(r) for r in history], "is_demo": True, "officially_submitted": False}

    def prepare_action(self, owner, kind, payload):
        preview = dict(payload)
        if kind == "reserve":
            self._window(payload["start_at"], payload["end_at"])
            with self.connect() as con:
                seat = con.execute("SELECT * FROM seats WHERE id=? AND disabled=0", (payload["seat_id"],)).fetchone()
                if seat is None:
                    raise AgentError("该座位不存在或已停用。")
                preview["seat_number"] = seat["seat_number"] or seat_number(seat["id"])
                preview["zone"] = seat["zone"]
        elif kind in ("cancel", "check_in", "release"):
            self.get_booking(owner, payload["booking_id"])
        elif kind != "feedback":
            raise AgentError("未知操作。")
        action_id = uuid.uuid4().hex
        expires = int(self.clock()) + 300
        with self.connect() as con:
            con.execute("INSERT INTO actions VALUES (?,?,?,?,?,NULL)", (action_id, owner, kind, json.dumps(payload, ensure_ascii=False), expires))
        return {"action_id": action_id, "kind": kind, "preview": preview, "requires_confirmation": True,
                "expires_at": iso(expires), "is_demo": True, "note": "仅生成待确认操作；尚未预约、签到或提交反馈。"}

    def confirm_action(self, owner, action_id):
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            action = con.execute("SELECT * FROM actions WHERE id=? AND owner=?", (action_id, owner)).fetchone()
            if action is None:
                raise AgentError("待确认操作不存在。")
            if action["result"]:
                return json.loads(action["result"])
            if action["expires_ts"] <= self.clock():
                raise AgentError("待确认操作已过期，请重新查询并生成操作。")
            self._expire(con)
            args = json.loads(action["payload"])
            kind = action["kind"]
            if kind == "reserve":
                start, end = self._window(args["start_at"], args["end_at"])
                if not con.execute("SELECT 1 FROM seats WHERE id=? AND disabled=0", (args["seat_id"],)).fetchone():
                    raise AgentError("该座位已停用，请重新选择。")
                clash = con.execute("""SELECT 1 FROM bookings WHERE seat_id=? AND status IN ('reserved','checked_in')
                    AND start_ts<? AND end_ts>?""", (args["seat_id"], end, start)).fetchone()
                if clash:
                    raise AgentError("该座位时段已被预约，请重新查询。")
                bid = "BK-" + uuid.uuid4().hex[:12]
                con.execute("INSERT INTO bookings VALUES (?,?,?,?,?,?)", (bid, owner, args["seat_id"], start, end, "reserved"))
                result = self._booking_result(con.execute(BOOKING_ROWS + " WHERE b.id=?", (bid,)).fetchone())
            elif kind in ("cancel", "check_in", "release"):
                row = con.execute("SELECT * FROM bookings WHERE id=? AND owner=?", (args["booking_id"], owner)).fetchone()
                if row is None or row["status"] not in ("reserved", "checked_in"):
                    raise AgentError("该预约当前不可执行此操作。")
                if kind == "check_in" and (row["status"] != "reserved" or self.clock() < row["start_ts"] - 900):
                    raise AgentError("演示签到仅允许开始前15分钟至开始后15分钟内操作。")
                if kind == "release" and row["status"] != "checked_in":
                    raise AgentError("只有使用中的预约可以退座。")
                if kind == "cancel" and row["status"] != "reserved":
                    raise AgentError("只有未签到的预约可以取消；使用中的座位请退座。")
                status = {"cancel": "cancelled", "check_in": "checked_in", "release": "completed"}[kind]
                con.execute("UPDATE bookings SET status=? WHERE id=?", (status, row["id"]))
                result = self._booking_result(con.execute(BOOKING_ROWS + " WHERE b.id=?", (row["id"],)).fetchone())
            else:
                tid = "FB-" + uuid.uuid4().hex[:12]
                con.execute("INSERT INTO tickets (id,owner,category,location,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", (tid, owner, args["category"], args["location"], args["description"], "pending", iso(self.clock()), iso(self.clock())))
                con.execute("INSERT INTO ticket_events (ticket_id,status,actor,note,created_at) VALUES (?,?,?,?,?)", (tid, "pending", owner, "读者提交反馈", iso(self.clock())))
                result = {"id": tid, "status": "pending", "is_demo": True, "officially_submitted": False}
            con.execute("UPDATE actions SET result=? WHERE id=?", (json.dumps(result, ensure_ascii=False), action_id))
            return result

    def list_books(self):
        with self.connect() as con:
            rows = con.execute("SELECT * FROM books ORDER BY id").fetchall()
        return {"items": [self._book_result(r) for r in rows]}

    def seat_map(self, owner, start_at=None, end_at=None):
        if start_at is None and end_at is None:
            start, end = int(self.clock()), int(self.clock()) + 7200
        else:
            start, end = self._window(start_at, end_at)
        with self.connect() as con:
            self._expire(con)
            seats = con.execute("SELECT * FROM seats ORDER BY floor,zone,row_no,col_no").fetchall()
            bookings = con.execute("""SELECT * FROM bookings WHERE status IN ('reserved','checked_in')
                AND start_ts<? AND end_ts>? ORDER BY start_ts,id""", (end, start)).fetchall()
        bookings_by_seat = {}
        for booking in bookings:
            bookings_by_seat.setdefault(booking["seat_id"], booking)
        items = []
        for row in seats:
            booking = bookings_by_seat.get(row["id"])
            state = "unavailable" if row["disabled"] else (booking["status"] if booking else "available")
            items.append({**self._seat_result(row), "status": state,
                          "my_booking_id": booking["id"] if booking and booking["owner"] == owner else None})
        return {"items": items, "start_at": iso(start), "end_at": iso(end), "is_demo": True,
                "inventory_source": "library_files" if self.campus_inventory else "sample"}

    def my_services(self, owner):
        with self.connect() as con:
            self._expire(con)
            bookings = con.execute(BOOKING_ROWS + " WHERE b.owner=? ORDER BY b.start_ts DESC LIMIT 30", (owner,)).fetchall()
            tickets = con.execute("SELECT id FROM tickets WHERE owner=? ORDER BY created_at DESC LIMIT 30", (owner,)).fetchall()
        return {"bookings": [self._booking_result(r) for r in bookings],
                "tickets": [self.get_feedback(owner, r["id"]) for r in tickets]}

    def overview(self, owner):
        now = int(self.clock())
        with self.connect() as con:
            self._expire(con)
            books_total = con.execute("SELECT count(*) FROM books").fetchone()[0]
            seats_total = con.execute("SELECT count(*) FROM seats").fetchone()[0]
            in_use = con.execute("""SELECT count(DISTINCT b.seat_id) FROM bookings b JOIN seats s ON b.seat_id=s.id
                WHERE b.status='checked_in' AND b.start_ts<=? AND b.end_ts>?""", (now, now)).fetchone()[0]
            reserved = con.execute("SELECT count(*) FROM bookings b JOIN seats s ON b.seat_id=s.id WHERE b.status='reserved'").fetchone()[0]
            pending = con.execute("SELECT count(*) FROM tickets WHERE status IN ('pending','processing')").fetchone()[0]
            total_tickets = con.execute("SELECT count(*) FROM tickets").fetchone()[0]
            hours = con.execute("SELECT CAST(strftime('%H',start_ts,'unixepoch','+8 hours') AS INTEGER) AS hour,count(*) AS count FROM bookings GROUP BY hour ORDER BY hour").fetchall()
        return {"books_total": books_total, "seats_total": seats_total, "in_use": in_use,
                "reserved": reserved, "pending_tickets": pending, "total_tickets": total_tickets,
                "utilization": round(in_use / seats_total * 100) if seats_total else 0,
                "hourly_bookings": [dict(r) for r in hours], "is_demo": True}

    def staff_tickets(self):
        with self.connect() as con:
            rows = con.execute("SELECT id,owner FROM tickets ORDER BY created_at DESC LIMIT 60").fetchall()
        return {"items": [self.get_feedback(r["owner"], r["id"]) for r in rows]}

    def update_ticket(self, owner, ticket_id, operation, reply="", staff=False):
        if not isinstance(reply, str) or len(reply) > 1000:
            raise AgentError("回复应不超过1000字符。")
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = con.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
            if row is None or (not staff and row["owner"] != owner):
                raise AgentError("未找到可处理的问题。")
            if staff:
                allowed = {("pending", "accept"): "processing", ("processing", "reply"): "replied"}
                status = allowed.get((row["status"], operation))
                if not status or (operation == "reply" and not reply.strip()):
                    raise AgentError("请按当前办理进度受理或填写处理回复。")
            else:
                status = {"confirm": "closed", "reopen": "processing"}.get(operation) if row["status"] == "replied" else None
                if status is None:
                    raise AgentError("当前反馈尚不可确认或重新处理。")
            con.execute("UPDATE tickets SET status=?,reply=?,updated_at=? WHERE id=?", (status, reply if staff and operation == "reply" else row["reply"], iso(self.clock()), ticket_id))
            note = reply or {"accept": "馆员已受理", "confirm": "读者确认已解决", "reopen": "读者申请重新处理"}.get(operation, "更新进度")
            con.execute("INSERT INTO ticket_events (ticket_id,status,actor,note,created_at) VALUES (?,?,?,?,?)", (ticket_id, status, "demo-staff" if staff else owner, note, iso(self.clock())))
        return self.get_feedback(row["owner"], ticket_id)

    def set_seat_disabled(self, seat_id, disabled):
        if type(disabled) is not bool:
            raise AgentError("停用状态应为布尔值。")
        with self.connect() as con:
            changed = con.execute("UPDATE seats SET disabled=? WHERE id=?", (int(disabled), seat_id))
            if not changed.rowcount:
                raise AgentError("座位不存在。")
        return {"id": seat_id, "disabled": disabled, "is_demo": True}

