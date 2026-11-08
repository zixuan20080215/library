"""DeepSeek adapter. No SDK, credentials, or external network needed for local demos."""
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
from urllib import error, request
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent


class AgentError(Exception):
    """A user-displayable error that must not contain a credential."""


@dataclass
class Settings:
    api_key: str = field(default="", repr=False)
    base_url: str = "https://api.deepseek.com"
    model: str = "deepseek-flash"
    max_rounds: int = 4
    max_tokens: int = 1800
    timeout: int = 45
    data_mode: str = "demo"
    database_path: str = "data/library_demo.sqlite3"
    library_api_base: str = ""
    library_api_token: str = field(default="", repr=False)

    @classmethod
    def load(cls, path=None):
        values = {}
        env_path = Path(path) if path else ROOT / ".env"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8-sig").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    values[key.strip()] = value.strip().strip("\"'")

        def get(key, default):
            return os.environ.get(key, values.get(key, default))

        try:
            return cls(
                api_key=get("DEEPSEEK_API_KEY", ""),
                base_url=get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/"),
                model=get("DEEPSEEK_MODEL", "deepseek-flash"),
                max_rounds=max(1, min(6, int(get("AGENT_MAX_ROUNDS", "4")))),
                max_tokens=max(256, min(4096, int(get("AGENT_MAX_TOKENS", "1800")))),
                timeout=max(5, min(90, int(get("AGENT_TIMEOUT_SECONDS", "45")))),
                data_mode=get("LIBRARY_DATA_MODE", "demo"),
                database_path=get("DATABASE_PATH", "data/library_demo.sqlite3"),
                library_api_base=get("LIBRARY_API_BASE_URL", "").rstrip("/"),
                library_api_token=get("LIBRARY_API_TOKEN", ""),
            )
        except ValueError as exc:
            raise AgentError("配置文件中的调用次数、输出长度或超时时间必须为整数。") from exc


class DeepSeekClient:
    def __init__(self, settings):
        self.settings = settings

    def complete(self, messages, tools):
        cfg = self.settings
        if not cfg.api_key.strip():
            raise AgentError("尚未配置DEEPSEEK_API_KEY；可先运行demo.py演示本地业务流程。")
        parsed = urlsplit(cfg.base_url)
        if parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
            raise AgentError("DEEPSEEK_BASE_URL必须是有效的HTTPS接口地址。")
        payload = {
            "model": cfg.model,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto",
            "thinking": {"type": "disabled"},
            "temperature": 0.2,
            "max_tokens": cfg.max_tokens,
            "stream": False,
        }
        req = request.Request(
            cfg.base_url + "/chat/completions",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Authorization": "Bearer " + cfg.api_key, "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=cfg.timeout) as response:
                raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise AgentError("模型响应过大，请缩小问题或输出长度。")
            result = json.loads(raw)
            if not isinstance(result, dict) or not result.get("choices"):
                raise AgentError("模型响应格式异常。")
            return result
        except error.HTTPError as exc:
            hints = {401: "请检查API Key。", 402: "请检查API余额。", 429: "调用受限，请稍后重试。"}
            raise AgentError(f"模型API返回HTTP {exc.code}。" + hints.get(exc.code, "请核对模型名称与配置。")) from exc
        except (error.URLError, TimeoutError, OSError) as exc:
            raise AgentError("无法连接模型API或调用超时，请检查网络后重试。") from exc
        except (ValueError, KeyError, TypeError) as exc:
            raise AgentError("模型响应不是有效的聊天接口数据。") from exc

