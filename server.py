"""Local application server: reader website, staff demo, and library/Agent APIs."""
import argparse
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import secrets
from threading import Lock
from time import monotonic
from urllib.parse import parse_qs, unquote, urlsplit

from agent import LibraryAgent
from data_gateway import create_repository
from demo_agent import DemoAgent
from model_client import AgentError, DeepSeekClient, ROOT, Settings
from tools import LibraryTools, TOOLS

WEB_ROOT = ROOT.parent / "web"
STAFF_DEMO_LOGIN = {"username": "user1", "password": "123456"}
STAFF_SESSION_COOKIE = "library_staff_session"
STAFF_SESSION_SECONDS = 3600

class Application:
    def __init__(self, repository=None, settings=None, client=None):
        self.settings = settings or Settings.load()
        self.repository = repository or create_repository(self.settings)
        self.tools = LibraryTools(self.repository)
        self.model_mode = "deepseek" if client or self.settings.api_key.strip() else "rule_demo"
        self.agent = (LibraryAgent(client or DeepSeekClient(self.settings), self.tools, self.settings)
                      if self.model_mode == "deepseek" else DemoAgent(self.tools))
        self.token = secrets.token_urlsafe(24)
        self.staff_token = secrets.token_urlsafe(24)
        self._staff_sessions = {}
        self._staff_sessions_lock = Lock()

    def config(self, staff=False):
        return {"model_mode": self.model_mode, "model_configured": bool(self.settings.api_key.strip()),
                "model": self.settings.model, "data_mode": self.settings.data_mode,
                "role": "staff_demo" if staff else "reader_demo", "official_system_connected": False}

    def start_staff_session(self, previous_session):
        session = secrets.token_urlsafe(32)
        with self._staff_sessions_lock:
            now = monotonic()
            self._staff_sessions = {key: expires for key, expires in self._staff_sessions.items()
                                    if key != previous_session and expires > now}
            self._staff_sessions[session] = now + STAFF_SESSION_SECONDS
        return session

    def has_staff_session(self, session):
        with self._staff_sessions_lock:
            return self._staff_sessions.get(session, 0) > monotonic()

    def end_staff_session(self, session):
        with self._staff_sessions_lock:
            self._staff_sessions.pop(session, None)


def staff_session_cookie(session, max_age):
    return f"{STAFF_SESSION_COOKIE}={session}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}"


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        def send_json(self, status, value, *, cookie=None):
            body = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(body)))
            if cookie is not None:
                self.send_header("Set-Cookie", cookie)
            self.end_headers()
            self.wfile.write(body)

        def authorized(self):
            supplied = self.headers.get("X-Demo-Token", "").encode()
            return secrets.compare_digest(supplied, app.token.encode()) or self.is_staff()

        def has_staff_token(self):
            supplied = self.headers.get("X-Demo-Token", "").encode()
            return secrets.compare_digest(supplied, app.staff_token.encode())

        def staff_session_id(self):
            try:
                cookie = SimpleCookie(self.headers.get("Cookie", "")).get(STAFF_SESSION_COOKIE)
            except CookieError:
                return ""
            return cookie.value if cookie else ""

        def is_staff(self):
            return self.has_staff_token() and app.has_staff_session(self.staff_session_id())

        def require_token_error(self):
            message = ("馆员登录已失效，请返回读者页面重新登录。" if self.has_staff_token()
                       else "请提供启动终端显示的X-Demo-Token。")
            return self.send_json(401, {"error": message})

        def valid_origin(self):
            host = self.headers.get("Host", "")
            if urlsplit("http://" + host).hostname not in ("127.0.0.1", "localhost"):
                return False
            origin = self.headers.get("Origin")
            return origin is None or origin in ("http://" + host,)

        def send_file(self, path):
            if path in ("/", "/index.html", "/staff"):
                staff = path == "/staff"
                if staff and not app.has_staff_session(self.staff_session_id()):
                    self.send_response(303)
                    self.send_header("Location", "/?staff_login=1")
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                source = WEB_ROOT / "index.html"
                if not source.is_file():
                    return self.send_json(404, {"error": "网页文件尚未就绪。"})
                config = {**app.config(staff), "api_token": app.staff_token if staff else app.token}
                if not staff:
                    config["staff_demo_login"] = STAFF_DEMO_LOGIN
                content = source.read_text(encoding="utf-8").replace("__APP_CONFIG_JSON__", json.dumps(config, ensure_ascii=False).replace("<", "\\u003c"))
                body = content.encode("utf-8")
                media_type = "text/html; charset=utf-8"
            else:
                source = (WEB_ROOT / unquote(path).lstrip("/")).resolve()
                if not source.is_relative_to(WEB_ROOT.resolve()) or not source.is_file() or source.suffix not in (".js", ".css", ".svg", ".png", ".jpg", ".ico"):
                    return self.send_json(404, {"error": "文件不存在。"})
                body = source.read_bytes()
                media_type = mimetypes.guess_type(str(source))[0] or "application/octet-stream"
                if source.suffix in (".js", ".css", ".svg"):
                    media_type += "; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", media_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if not self.valid_origin():
                return self.send_json(403, {"error": "仅支持本机同源访问。"})
            parsed = urlsplit(self.path)
            if parsed.path == "/health":
                return self.send_json(200, {"ok": True, "model_configured": bool(app.settings.api_key),
                                            "official_system_connected": False, "mode": "local_demo"})
            if not parsed.path.startswith("/api/"):
                return self.send_file(parsed.path)
            if not self.authorized():
                return self.require_token_error()
            try:
                params = parse_qs(parsed.query)
                if parsed.path == "/api/bootstrap":
                    return self.send_json(200, {"config": app.config(self.is_staff()), "overview": app.repository.overview(app.tools.owner),
                                                "books": app.repository.list_books(), "seats": app.repository.seat_map(app.tools.owner),
                                                "services": app.repository.my_services(app.tools.owner)})
                if parsed.path == "/api/tools":
                    return self.send_json(200, {"tools": TOOLS})
                if parsed.path == "/api/services":
                    return self.send_json(200, app.repository.my_services(app.tools.owner))
                if parsed.path == "/api/seats/map":
                    return self.send_json(200, app.repository.seat_map(app.tools.owner, params.get("start_at", [None])[0], params.get("end_at", [None])[0]))
                if parsed.path == "/api/staff/tickets":
                    if not self.is_staff():
                        return self.send_json(403, {"error": "请进入馆员演示工作台。"})
                    return self.send_json(200, app.repository.staff_tickets())
                if parsed.path in ("/api/books", "/api/rules"):
                    query = params.get("q", [""])[0]
                    if parsed.path == "/api/books" and not query.strip():
                        return self.send_json(200, app.repository.list_books())
                    name = "search_books" if parsed.path == "/api/books" else "search_rules"
                    result = app.tools.call(name, json.dumps({"query": query}))
                    return self.send_json(400 if "error" in result else 200, result)
                self.send_json(404, {"error": "接口不存在。"})
            except AgentError as exc:
                self.send_json(400, {"error": str(exc)})
            except Exception as exc:
                print("Local read error:", type(exc).__name__)
                self.send_json(500, {"error": "数据读取失败，请检查数据接口。"})

        def do_POST(self):
            if not self.valid_origin():
                return self.send_json(403, {"error": "仅支持本机同源访问。"})
            path = urlsplit(self.path).path
            # A same-origin logout can clear its own cookie after a session expires or the service restarts.
            if path != "/api/staff/logout" and not self.authorized():
                return self.require_token_error()
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if size < 1 or size > 32768:
                    raise AgentError("请求体应为1至32768字节。")
                if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
                    raise AgentError("请求格式应为application/json。")
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise AgentError("请求体应为JSON对象。")
                if path == "/api/staff/login":
                    if data != STAFF_DEMO_LOGIN:
                        return self.send_json(401, {"error": "管理员名称或密码不正确。"})
                    session = app.start_staff_session(self.staff_session_id())
                    return self.send_json(200, {"ok": True}, cookie=staff_session_cookie(session, STAFF_SESSION_SECONDS))
                if path == "/api/staff/logout":
                    app.end_staff_session(self.staff_session_id())
                    return self.send_json(200, {"ok": True}, cookie=staff_session_cookie("", 0))
                if path == "/api/chat":
                    if set(data) - {"message", "session_id"}:
                        raise AgentError("聊天接口只接收message和session_id。")
                    if data.get("session_id") is not None and not isinstance(data["session_id"], str):
                        raise AgentError("session_id必须是字符串。")
                    result = app.agent.chat(data.get("message"), data.get("session_id"))
                    return self.send_json(200, {**result, "mode": app.model_mode})
                if path == "/api/tool-preview":
                    if set(data) != {"name", "arguments"} or not isinstance(data["name"], str):
                        raise AgentError("工具演示接口接收name和arguments。")
                    result = app.tools.call(data["name"], json.dumps(data["arguments"], ensure_ascii=False))
                    return self.send_json(400 if "error" in result else 200, result)
                if path == "/api/actions/confirm":
                    if set(data) != {"action_id"} or not isinstance(data["action_id"], str):
                        raise AgentError("确认接口只接收action_id。")
                    result = app.repository.confirm_action(app.tools.owner, data["action_id"])
                    if hasattr(app.agent, "observe_action"):
                        app.agent.observe_action(result)
                    return self.send_json(200, result)
                if path in ("/api/tickets/update", "/api/staff/tickets/update"):
                    staff = path.startswith("/api/staff/")
                    if staff and not self.is_staff():
                        return self.send_json(403, {"error": "馆员操作需要馆员演示身份。"})
                    if set(data) - {"ticket_id", "operation", "reply"} or not all(isinstance(data.get(k), str) for k in ("ticket_id", "operation")):
                        raise AgentError("问题更新需要ticket_id、operation及可选reply。")
                    return self.send_json(200, app.repository.update_ticket(app.tools.owner, data["ticket_id"], data["operation"], data.get("reply", ""), staff=staff))
                if path == "/api/staff/seats/update":
                    if not self.is_staff():
                        return self.send_json(403, {"error": "馆员操作需要馆员演示身份。"})
                    if set(data) != {"seat_id", "disabled"} or not isinstance(data["seat_id"], str):
                        raise AgentError("座位更新需要seat_id和disabled。")
                    return self.send_json(200, app.repository.set_seat_disabled(**data))
                self.send_json(404, {"error": "接口不存在。"})
            except (AgentError, ValueError, UnicodeDecodeError) as exc:
                message = str(exc) if isinstance(exc, AgentError) else "请求JSON或长度格式不正确。"
                self.send_json(400, {"error": message})
            except Exception as exc:
                print("Local backend error:", type(exc).__name__)
                self.send_json(500, {"error": "本地业务处理失败，请查看终端错误类型。"})

        def log_message(self, format, *args):
            # Do not log queries, chat bodies, tokens, or API credentials.
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser(description="Local library Agent JSON API")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    app = Application()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(app))
    print(f"智能图书馆: http://127.0.0.1:{args.port}")
    print(f"馆员演示: http://127.0.0.1:{args.port}/staff")
    print("X-Demo-Token:", app.token)
    print("DeepSeek configured:", bool(app.settings.api_key))
    print("Local demo only; no official system connected. Ctrl+C stops the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

