"""Stable data-service boundary: local SQLite or a future authorized HTTPS service."""
import json
import time
from pathlib import Path
from urllib import error, request
from urllib.parse import urlsplit

from model_client import AgentError, ROOT
from repository import LibraryRepository
from institution_profiles import bundled_profile


class HTTPDataRepository:
    """Connect to OUR documented contract, not an assumed existing university API."""
    def __init__(self, base_url, token):
        parsed = urlsplit(base_url)
        if parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
            raise AgentError("真实数据模式需要配置有效的HTTPS LIBRARY_API_BASE_URL。")
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.clock = time.time

    def invoke(self, operation, **arguments):
        # Operation names come only from the fixed methods below.
        req = request.Request(self.base_url + "/library/v1/" + operation,
                              json.dumps(arguments, ensure_ascii=False).encode("utf-8"),
                              {"Content-Type": "application/json", "Authorization": "Bearer " + self.token}, method="POST")
        try:
            with request.urlopen(req, timeout=15) as res:
                raw = res.read(2_000_001)
            if len(raw) > 2_000_000:
                raise AgentError("数据服务返回内容过大。")
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise AgentError("数据服务应返回JSON对象。")
            if result.get("error"):
                raise AgentError("数据服务拒绝此操作，请检查授权、条件和当前状态。")
            return result
        except (error.URLError, OSError, ValueError) as exc:
            raise AgentError("暂时无法访问已配置的数据服务，请检查接口与授权。") from exc

    def search_books(self, query, limit=5): return self.invoke("books/search", query=query, limit=limit)
    def get_institution_profile(self, profile_id): return bundled_profile(profile_id)
    def locate_book(self, book_id): return self.invoke("books/locate", book_id=book_id)
    def search_seats(self, start_at, end_at, limit=5, **filters): return self.invoke("seats/search", start_at=start_at, end_at=end_at, limit=limit, **filters)
    def get_booking(self, owner, booking_id): return self.invoke("bookings/get", owner=owner, booking_id=booking_id)
    def get_feedback(self, owner, ticket_id): return self.invoke("tickets/get", owner=owner, ticket_id=ticket_id)
    def prepare_action(self, owner, kind, payload): return self.invoke("actions/prepare", owner=owner, kind=kind, payload=payload)
    def confirm_action(self, owner, action_id): return self.invoke("actions/confirm", owner=owner, action_id=action_id)
    def list_books(self): return self.invoke("books/list", limit=60)
    def seat_map(self, owner, start_at=None, end_at=None): return self.invoke("seats/map", owner=owner, start_at=start_at, end_at=end_at)
    def my_services(self, owner): return self.invoke("readers/services", owner=owner)
    def overview(self, owner): return self.invoke("overview", owner=owner)
    def staff_tickets(self): return self.invoke("staff/tickets")
    def update_ticket(self, owner, ticket_id, operation, reply="", staff=False): return self.invoke("tickets/update", owner=owner, ticket_id=ticket_id, operation=operation, reply=reply, staff=staff)
    def set_seat_disabled(self, seat_id, disabled): return self.invoke("staff/seats/update", seat_id=seat_id, disabled=disabled)


def create_repository(settings):
    if settings.data_mode == "http":
        return HTTPDataRepository(settings.library_api_base, settings.library_api_token)
    if settings.data_mode != "demo":
        raise AgentError("LIBRARY_DATA_MODE应为demo或http。")
    path = Path(settings.database_path)
    campus_directory = ROOT.parent / "江苏大学图书馆资料"
    return LibraryRepository(
        path if path.is_absolute() else ROOT / path,
        campus_directory=campus_directory if campus_directory.is_dir() else None,
    )
