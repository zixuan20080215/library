"""Build a fully standalone HTML edition with embedded data, assets and offline APIs."""
import base64
import json
import mimetypes
from pathlib import Path
import re
import sys
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
sys.path.insert(0, str(ROOT / "agent_backend"))
from demo_agent import TOPICS  # noqa: E402
from demo_knowledge import KNOWLEDGE  # noqa: E402
from institution_profiles import PROFILE_QUERIES, PROFILE_EXCLUSION  # noqa: E402
from repository import LibraryRepository  # noqa: E402

OUTPUT = ROOT / "江苏大学智能图书馆_手机电脑离线版.html"
README = ROOT / "离线版使用说明.txt"
ARCHIVE = ROOT / "江苏大学智能图书馆_手机电脑离线版.zip"
MODULE_ORDER = ["icons.js", "ui.js", "seat-layouts.js", "characters.js", "views.js", "assistant.js", "app.js"]


def module_identifier(name):
    return f"web/{name}"


def transform_module(name, source):
    exports = []
    source = source.replace("export let runtime={};", "export const runtime={};")
    source = source.replace("export function setRuntime(config){runtime=config;}",
                            "export function setRuntime(config){Object.assign(runtime,config);}")
    source = re.sub(r"export async function api\(path, data\)\{[^\n]+\}",
                    "export async function api(path,data){return window.__offlineApi(path,data);}", source)
    if name == "app.js":
        source = source.replace("location.assign('/staff')", "location.reload()")
        source = source.replace("location.assign('/')", "location.reload()")
        source = source.replace("roleLink.href = '/';", "roleLink.href = '#home';")
        source = source.replace("请通过项目文件夹中的“启动智能图书馆.cmd”启动，再访问终端显示的本地地址。",
                                "请使用新版 Chrome、Edge 或支持本地 HTML 的浏览器重新打开此离线文件。")
        source = source.replace("<code>python -X utf8 agent_backend\\\\server.py</code>", "")
    if name == "views.js":
        source = source.replace("s.config.data_mode==='demo'?'本地资料与预约记录':'外部数据接口'",
                                "['demo','offline'].includes(s.config.data_mode)?'本地资料与预约记录':'外部数据接口'")

    def named_import(match):
        names, path = match.groups()
        target = module_identifier(path.rsplit("/", 1)[-1])
        return f"const {{{names}}}=__require({json.dumps(target)});"

    source = re.sub(r"import\s*\{([^}]+)\}\s*from\s*['\"](.+?)['\"];?", named_import, source)

    def namespace_import(match):
        alias, path = match.groups()
        target = module_identifier(path.rsplit("/", 1)[-1])
        return f"const {alias}=__require({json.dumps(target)});"

    source = re.sub(r"import\s*\*\s*as\s+(\w+)\s*from\s*['\"](.+?)['\"];?", namespace_import, source)
    for pattern, replacement in (
        (r"export\s+async\s+function\s+(\w+)", r"async function \1"),
        (r"export\s+function\s+(\w+)", r"function \1"),
        (r"export\s+const\s+(\w+)", r"const \1"),
    ):
        exports.extend(re.findall(pattern, source))
        source = re.sub(pattern, replacement, source)
    if re.search(r"^\s*(?:import|export)\s", source, re.M):
        raise ValueError(f"{name} 仍有未处理的模块语法")
    assignments = "\n" + "\n".join(f"__exports.{export}={export};" for export in dict.fromkeys(exports))
    return source + assignments


def bundle_javascript():
    registry = []
    for name in MODULE_ORDER:
        source = transform_module(name, (WEB / name).read_text(encoding="utf-8"))
        registry.append(f"__modules[{json.dumps(module_identifier(name))}]=function(__exports){{\n{source}\n}};")
    return """(()=>{
const __modules={},__cache={};
function __require(id){
  if(__cache[id])return __cache[id];
  const exports={};__cache[id]=exports;__modules[id](exports);return exports;
}
""" + "\n".join(registry) + "\n__require('web/app.js');\n})();"


def campus_data():
    with tempfile.TemporaryDirectory(prefix="library_offline_build_") as directory:
        repo = LibraryRepository(Path(directory) / "offline.sqlite3", campus_directory=ROOT / "江苏大学图书馆资料")
        books = repo.list_books()["items"]
        seats = repo.seat_map("demo-reader")["items"]
        profiles = repo.list_institution_profiles()
    for item in seats:
        item.pop("my_booking_id", None)
        item["status"] = "available"
    return books, seats, profiles


def embed_assets(html):
    for path in (WEB / "assets").rglob("*"):
        if not path.is_file() or path.suffix.lower() not in {".png", ".svg", ".jpg", ".ico"}:
            continue
        relative = "/assets/" + path.relative_to(WEB / "assets").as_posix()
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        uri = f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")
        html = html.replace(relative, uri)
    return html


def main():
    books, seats, profiles = campus_data()
    payload = {"books": books, "seats": seats, "knowledge": KNOWLEDGE, "topics": TOPICS,
               "institution_profiles": profiles, "profile_queries": PROFILE_QUERIES, "profile_exclusion": PROFILE_EXCLUSION}
    data_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    config = {"model_mode": "rule_demo", "model_configured": False, "model": "offline-rules",
              "data_mode": "offline", "role": "reader_demo", "official_system_connected": False,
              "api_token": "offline", "staff_demo_login": {"username": "user1", "password": "123456"}}
    html = (WEB / "index.html").read_text(encoding="utf-8")
    html = html.replace("<title>江苏大学智能图书馆</title>", "<title>江苏大学智能图书馆 · 手机电脑离线版</title>")
    html = html.replace('<a class="brand" href="/"', '<a class="brand" href="#home"')
    html = html.replace('href="/staff" id="role-link"', 'href="#staff" id="role-link"')
    html = html.replace('<span class="status-dot"></span>演示环境', '<span class="status-dot"></span>离线版 · 本机存储')
    html = html.replace("预约与反馈记录由本站管理", "离线单文件 · 记录保存在当前浏览器")
    css = (WEB / "styles.css").read_text(encoding="utf-8") + "\n" + (WEB / "visual-refresh.css").read_text(encoding="utf-8")
    html = re.sub(r'\s*<link rel="stylesheet" href="/styles\.css">\s*<link rel="stylesheet" href="/visual-refresh\.css">',
                  lambda _: "\n<style>\n" + css + "\n</style>", html)
    config_json = json.dumps(config, ensure_ascii=False).replace("<", "\\u003c")
    html = html.replace("__APP_CONFIG_JSON__", config_json)
    scripts = """
<script>
try{if(sessionStorage.getItem('ujs.offlineLibrary.staff')==='1'){
  const node=document.querySelector('#runtime-config'),config=JSON.parse(node.textContent);
  config.role='staff_demo';delete config.staff_demo_login;node.textContent=JSON.stringify(config);
}}catch{}
</script>
<script>window.__OFFLINE_DATA__=__OFFLINE_DATA_JSON__;</script>
<script>__OFFLINE_BACKEND__</script>
<script>__OFFLINE_DIALOGUE_RULES__</script>
<script>__OFFLINE_CHAT__</script>
<script>__APP_BUNDLE__</script>
"""
    scripts = scripts.replace("__OFFLINE_DATA_JSON__", data_json)
    scripts = scripts.replace("__OFFLINE_BACKEND__", (WEB / "offline-backend.js").read_text(encoding="utf-8"))
    scripts = scripts.replace("__OFFLINE_DIALOGUE_RULES__", (WEB / "offline-dialogue-rules.js").read_text(encoding="utf-8"))
    scripts = scripts.replace("__OFFLINE_CHAT__", (WEB / "offline-chat.js").read_text(encoding="utf-8"))
    scripts = scripts.replace("__APP_BUNDLE__", bundle_javascript())
    html = re.sub(r'\s*<script type="module" src="/app\.js"></script>', lambda _: scripts, html)
    html = embed_assets(html)
    OUTPUT.write_text(html, encoding="utf-8")
    README.write_text("""江苏大学智能图书馆｜手机电脑离线单文件版

一、怎么打开
1. 解压 ZIP，得到“江苏大学智能图书馆_手机电脑离线版.html”。
2. Windows / macOS：双击 HTML，或右键选择 Chrome、Edge、Firefox、Safari 打开。
3. 安卓手机：把 HTML 保存到本机，在“文件”中选择用 Chrome 或 Edge 打开。
4. 微信、QQ 内置预览如果只显示文字或不能点击，请下载后用浏览器打开，不要直接依赖聊天窗口预览。
5. iPhone / iPad：系统“文件”预览对本地 HTML 的支持因版本而异；若无法交互，请使用支持本地 HTML 的浏览器/文档应用，或改用电脑打开。

二、不需要什么
不需要安装 Python，不需要启动服务器，不需要联网，不需要 DeepSeek Key。
网页、图片、247 条书目、9 个阅览室、2161 个座位和规则 AI 全部在这一个 HTML 中。

三、可以做什么
馆藏检索、书目详情、座位图缩放、预约、签到、取消、退座、事务反馈、我的服务、馆员受理回复、座位停用恢复，以及本地规则 AI 对话。
馆员演示账号：user1；密码：123456。

四、记录存在哪里
预约、反馈和馆员办理记录只保存在当前浏览器的 localStorage 中，不上传学校或任何服务器。
手机与电脑不互通；不同浏览器不互通；清理网站数据、删除浏览器数据或使用隐私窗口可能丢失记录。
尽量不要移动或重命名 HTML；部分浏览器会按文件路径区分本地记录。
规则 AI 的聊天上下文只保留在当前页面，刷新后新建对话；已经确认的业务记录不会因刷新删除。
每次对话最多 10 轮有效文字问答，包含问候和兜底回复；第 11 次及之后会提示已超出轮数上限。
点击“开始新对话”重置聊天与轮数；切换馆员不重置。业务卡片的查看、确认不占对话轮数。
支持分次补充查书主题、查询候选详情、换一批、选座时段与楼层、反馈地点和描述。

五、演示边界
这是星光杯参赛原型，不连接学校实时馆藏、借还、统一身份认证或正式工单。
插座、靠窗等座位设施资料不完整，图书可借状态和部分馆藏位置仍待确认。
规则 AI 不是实时大模型；未收录的开放式问题会引导到已有功能。
指定政治话题采用固定公开资料回复，附资料来源；正常的相关书目检索仍可进行。
关键词规则不能覆盖所有隐喻、同音或绕写表达，能力边界与验收记录见项目开发文档。
""", encoding="utf-8")
    with ZipFile(ARCHIVE, "w", compression=ZIP_DEFLATED, compresslevel=6) as bundle:
        bundle.write(OUTPUT, OUTPUT.name)
        bundle.write(README, README.name)
    with ZipFile(ARCHIVE) as bundle:
        assert bundle.testzip() is None
    print(json.dumps({"html": OUTPUT.name, "html_bytes": OUTPUT.stat().st_size,
                      "zip": ARCHIVE.name, "zip_bytes": ARCHIVE.stat().st_size,
                      "books": len(books), "seats": len(seats), "knowledge": len(KNOWLEDGE)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
