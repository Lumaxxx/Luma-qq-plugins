"""browser-use 经典版：让模型按「阿圆的兴趣」自己上网逛。

用法（在 <WEBAGENT_HOME> 下）：
    .venv\\Scripts\\python.exe run_ayu.py --default
    .venv\\Scripts\\python.exe run_ayu.py "任务描述"
    .venv\\Scripts\\python.exe run_ayu.py --max-steps 8 "任务描述"

实现要点：
  - 用系统 Edge（Chromium 内核）作为浏览器，免下载 Playwright 内核
  - 自己拉起 Edge 的 CDP（127.0.0.1:9222），再交给 browser-use
  - 密钥来自 DEEPSEEK_API_KEY 或 <QQ_HOME>\\ayu-secret.env
"""
import argparse
import asyncio
import io
import os
import subprocess
import sys
import time
import urllib.request

# Windows 控制台默认 GBK，browser-use 日志里的 emoji 会炸；统一成 UTF-8
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from browser_use import Agent, Browser, BrowserConfig

PERSONA = (
    "你是「阿圆」，一个会用浏览器上网的 AI 网友（喜欢 AI、数码硬件、吃瓜扒皮、城市纪录片）。"
    "你可以自己决定打开哪个网站、点哪里、搜什么，不需要等用户指定。"
)

TASKS = {
    "search": (
        "用你自己挑的搜索引擎（必应/百度/Google 都行）搜索「{q}」，"
        "打开最相关的 2-3 个结果并读完，"
        "输出：结论 + 3 条关键信息 + 来源链接。"
    ),
    "ask": (
        "回答这个问题：「{q}」。"
        "自己选择可信的网站（官网 / 百科 / 知乎 / 新闻 / 文档），至少看两个来源，"
        "最后给出答案并注明你依据的是哪些站点。"
    ),
    "visit": "打开 {url} ，完成这些要求：{what}",
    "explore": (
        "按你的兴趣自己决定去哪：AI、数码硬件、吃瓜扒皮、城市/纪录片，"
        "逛 2-3 个不同的网站（不要只去一个），"
        "带回一条你觉得最值得分享的内容，说明在哪看到的、为什么值得看。"
    ),
}

EDGE_PATHS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

CDP_PORT = 9222


def load_key() -> str:
    key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if key.startswith("sk-"):
        return key
    env_path = r"<QQ_HOME>\ayu-secret.env"
    if os.path.exists(env_path):
        with io.open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("DEEPSEEK_API_KEY="):
                    value = line.split("=", 1)[1].strip().strip('"')
                    if value.startswith("sk-"):
                        return value
    raise SystemExit("没有找到 DeepSeek API Key（环境变量或 ayu-secret.env）")


def find_edge() -> str:
    for path in EDGE_PATHS:
        if os.path.exists(path):
            return path
    raise SystemExit("没有找到 Edge，请确认已安装")


CDP_PORT = 9333


def cdp_alive() -> bool:
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=1).read()
        return True
    except Exception:
        return False


def start_edge(headless: bool):
    """用独立数据目录起一个 Edge（不会动用户自己开着的 Edge）。

    返回 (proc, started)：started=False 表示复用了已在跑的托管实例。
    """
    if cdp_alive():
        return None, False

    edge = find_edge()
    profile = os.path.join(os.path.dirname(os.path.abspath(__file__)), "edge-profile")
    args = [
        edge,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={profile}",
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
        "about:blank",
    ]
    if headless:
        args.insert(1, "--headless=new")

    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        if cdp_alive():
            return proc, True
        time.sleep(0.5)
    raise SystemExit("Edge 的 CDP 没起来（127.0.0.1:%d）" % CDP_PORT)


RESULT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "last_result.txt")


def save_result_and_exit(text: str) -> None:
    """先落盘再强制退出，绕开 browser-use 收尾时卡在浏览器清理的问题。"""
    try:
        io.open(RESULT_PATH, "w", encoding="utf-8").write(text or "")
    except Exception:
        pass
    print("\n=== 结果 ===")
    print(text)
    print("\n(saved to", RESULT_PATH + ")")
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    except Exception:
        pass
    os._exit(0)


async def run_task(task: str, max_steps: int, headless: bool) -> None:
    key = load_key()

    from langchain_openai import ChatOpenAI

    llm = ChatOpenAI(
        model="deepseek-chat",
        base_url="https://api.deepseek.com/v1",
        api_key=key,
        temperature=0.2,
    )

    edge_proc, edge_started = start_edge(headless)

    def stop_owned_edge():
        # 只关自己起的那个实例；复用的托管实例留给下次用
        if edge_started and edge_proc is not None:
            try:
                edge_proc.kill()
            except Exception:
                pass

    async def on_done(history) -> None:
        # 任务结束回调：这里立刻落盘并退出，不等 agent.run() 自己清理
        try:
            text = history.final_result() or ""
        except Exception:
            text = ""
        stop_owned_edge()
        save_result_and_exit(text)

    try:
        browser = Browser(config=BrowserConfig(cdp_url=f"http://127.0.0.1:{CDP_PORT}"))
        agent = Agent(
            task=task,
            llm=llm,
            browser=browser,
            use_vision=False,
            register_done_callback=on_done,
        )
        await agent.run(max_steps=max_steps)
        # 正常返回（回调没触发）也走同一出口
        try:
            text = agent.history.final_result() or ""
        except Exception:
            text = ""
        save_result_and_exit(text)
    except BaseException as e:
        stop_owned_edge()
        save_result_and_exit(f"(运行出错：{type(e).__name__}: {e})")


def build_task(parts: list[str]) -> str:
    if not parts:
        return TASKS["explore"]
    mode = parts[0].lower()
    rest = parts[1:]
    if mode == "explore":
        return TASKS["explore"]
    if mode == "search":
        return TASKS["search"].format(q=" ".join(rest))
    if mode == "ask":
        return TASKS["ask"].format(q=" ".join(rest))
    if mode == "visit":
        if len(rest) == 0:
            raise SystemExit("用法：run_ayu.py visit <网址> [要求]")
        url = rest[0]
        what = " ".join(rest[1:]) or "读一下页面的主要内容并总结三点"
        return TASKS["visit"].format(url=url, what=what)
    if mode == "free":
        return " ".join(rest)
    # 不是已知模式：整句当自由任务
    return " ".join(parts)


def main():
    parser = argparse.ArgumentParser(
        description="阿圆上网：search / ask / visit / explore / free，或者直接给一句任务",
    )
    parser.add_argument("parts", nargs=argparse.REMAINDER, help="模式 + 内容")
    parser.add_argument("--headless", action="store_true", help="不显示浏览器窗口（默认会开一个独立窗口）")
    parser.add_argument("--max-steps", type=int, default=12)
    args = parser.parse_args()

    # 默认开一个独立窗口（用户自己的 Edge 不受影响）；要隐身用 --headless
    headless = args.headless or os.environ.get("AYU_HEADLESS") == "1"
    task = build_task([p for p in args.parts if p != "--"])
    task = PERSONA + "\n任务：" + task
    asyncio.run(run_task(task, args.max_steps, headless=headless))


if __name__ == "__main__":
    main()
