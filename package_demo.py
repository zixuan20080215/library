"""Build the portable demo archive using the standard library."""

from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "江苏大学智能图书馆_演示原型.zip"
FIXED_FILES = (
    "README.md", "运行与接入说明.md", "启动智能图书馆.cmd",
    "scripts/package_demo.py", "scripts/demo_dialogue_smoke.py", "scripts/build_offline.py",
    "scripts/offline_test.cjs", "scripts/offline_dialogue_test.cjs", "package.json",
    "agent_backend/.env.example", "agent_backend/.gitignore",
    "agent_backend/browser_test.cjs", "agent_backend/books_template.csv",
    "agent_backend/README.md", "agent_backend/DATABASE_API.md", "agent_backend/演示运行结果.json",
    "web/index.html", "agent_backend/server.py",
    "开发文档/开发与发布.md", "开发文档/架构与接口.md", "开发文档/数据维护.md", "开发文档/前端维护.md",
    "江苏大学图书馆资料/座位表.csv", "江苏大学图书馆资料/座位汇总.csv",
    "江苏大学图书馆资料/2025年读者荐购书单.csv", "江苏大学图书馆资料/2025年芸台购书单.csv",
    "江苏大学图书馆资料/说明.txt",
    "江苏大学图书馆资料/学校与图书馆简介.json",
    "网页预览/首页-电脑.png", "网页预览/首页-手机.png", "网页预览/选座-电脑.png", "网页预览/选座-手机.png",
    "网页预览/馆员登录.png", "网页预览/馆员工作台.png", "网页预览/Agent侧栏.png",
    "网页预览/交付验证记录.json", "网页预览/浏览器验证结果.json",
    "网页预览/离线对话验证结果.json", "网页预览/离线版验证结果.json", "网页预览/离线Agent-轮数上限.png",
    "网页预览/离线Agent-手机.png", "网页预览/离线版-电脑.png", "网页预览/离线版-手机.png",
    "网页预览/离线Agent-学校与图书馆简介.png", "网页预览/简介入库验证结果.json",
)
WEB_EXTENSIONS = {".html", ".css", ".js", ".svg", ".png", ".jpg", ".ico", ".md"}


def release_files():
    files = {ROOT / name for name in FIXED_FILES}
    files.update((ROOT / "agent_backend").glob("*.py"))
    files.update((ROOT / "开发文档").rglob("*.md"))
    files.update(path for path in (ROOT / "web").iterdir() if path.suffix.lower() in WEB_EXTENSIONS)
    files.update(path for path in (ROOT / "web" / "assets").rglob("*")
                 if path.is_file() and path.suffix.lower() in WEB_EXTENSIONS)
    for path in files:
        if not path.is_file() or not path.resolve().is_relative_to(ROOT):
            raise ValueError(f"无法打包文件 {path.relative_to(ROOT)}")
    return sorted(files)


def main():
    files = release_files()
    with NamedTemporaryFile(dir=ROOT, prefix=".demo-release-", suffix=".tmp", delete=False) as output:
        draft = Path(output.name)
    try:
        with ZipFile(draft, "w", compression=ZIP_DEFLATED, compresslevel=6) as bundle:
            for path in files:
                bundle.write(path, path.relative_to(ROOT).as_posix())
        with ZipFile(draft) as bundle:
            if bad_file := bundle.testzip():
                raise ValueError(f"压缩包校验失败 {bad_file}")
        draft.replace(ARCHIVE)
    finally:
        draft.unlink(missing_ok=True)
    print(f"已生成 {ARCHIVE.name}，共 {len(files)} 个文件")


if __name__ == "__main__":
    main()
