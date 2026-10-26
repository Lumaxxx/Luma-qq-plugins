# Zerolan 浏览器控制：完成与用法（2026-10-26）

## 结论

浏览器控制已经能用了：Selenium + Firefox，自动找 driver、自动用你的 Firefox 配置目录（登录状态保留），可以打开网页、搜索、点击、输入、截图。

实测：
- 打开 `example.com` ✅
- Bing 搜索 `DeepSeek Harness` → 10 条结果 ✅
- 截图 196.8 KB ✅

## 修了哪些问题

| 文件 | 问题 | 修复 |
| --- | --- | --- |
| `services/browser/driver.py` | `get_driver()` 拿枚举 `SeleniumDriverEnum.Firefox` 和字符串 `"firefox"` 比较永远不等 → 返回 `None`，一用就崩 | 统一转小写比较，未知驱动直接报错 |
| `services/browser/driver.py` | 从不调用 `find_firefox_profile_dir()`，`profile_dir=None` 时直接传给 `FirefoxProfile` 会炸 | 先找 profile，找不到才不挂 profile |
| `services/browser/browser.py` | `move_to_search_box()` 里用了未定义的 `driver`，且没有 `perform()` | 重写：用 `ActionChains(...).move_to_element(box).perform()` |
| `services/browser/browser.py` | `search()` 只认 Bing 的 `sb_form_q` | 改成按 bing/google/百度/通用依次尝试，找不到就明确报错 |
| `services/browser/browser.py` | `close()` 之后对象仍是旧 driver；没有 quit | 区分 `close()`（关标签页）和 `quit()`（退出浏览器） |
| `bot.py` 语音处理 | 「网页搜索」用 `transcript[4:]` 硬切，搜的内容错位；浏览器没打开时直接崩 | 用 `replace("网页搜索","",1).strip()`，没打开就先打开再搜 |
| `resources/config.yaml` | `room_id: -1`、`qq_num: <BOT_QQ>`、`root: -1` 被 pydantic 当 int，报 `string_type` 校验错误，整个程序起不来 | 改成带引号的字符串 |

## 环境

| 项 | 值 |
| --- | --- |
| Firefox | 158.0.1（`C:\Program Files\Mozilla Firefox`） |
| Firefox 配置目录 | `%APPDATA%\Mozilla\Firefox\Profiles\j8cqk4ou.default-release`（自动识别） |
| geckodriver | selenium 4.51 自动下载，缓存在 `<USER_HOME>\.cache\selenium\geckodriver\win64\0.37.1` |
| selenium | 4.51.0（venv 里已装） |

## 配置（`resources/config.yaml`）

```yaml
service:
  browser:
    enable: True
    profile_dir: None     # None=自动找 .default-release
    driver: 'Firefox'     # 只支持 Firefox；chrome 仍是 NotImplemented
```

## 手动用法

在项目根目录（`<USER_HOME>\ZerolanLiveRobot-2.3.0`）运行：

```bat
:: 打开网页
.venv\Scripts\python.exe tools\browser_demo.py open https://example.com

:: 打开并搜索
.venv\Scripts\python.exe tools\browser_demo.py open https://www.bing.com --search "AI 直播"

:: 直接搜索（自动开 bing）
.venv\Scripts\python.exe tools\browser_demo.py search "deepseek 是什么"

:: 截图
.venv\Scripts\python.exe tools\browser_demo.py shot C:\temp\a.png
```

代码里用：

```python
from services.browser.config import BrowserConfig
from services.browser.browser import Browser

b = Browser(get_config().service.browser)
b.open("https://www.bing.com")
b.search("AI 直播")
b.click("#某个选择器")
b.type("input[name=q]", "关键词", enter=True)
b.screenshot("shot.png")
b.quit()
```

## 语音指令（接 ASR 后生效）

| 说的话 | 动作 |
| --- | --- |
| 打开浏览器 | 打开 Bing |
| 网页搜索 XXX | 在当前页搜索 XXX（没开就先开 Bing） |
| 关闭浏览器 | 退出 Firefox |

## 注意

1. **必须在项目根目录启动**，否则 `manager/config_manager.py` 的 LICENSE 校验会找不到项目 LICENSE 并 `exit()`。
2. 首次运行会下载 geckodriver（约 4MB），之后走缓存。
3. 浏览器是**有界面**的（VLA 要控鼠标键盘），不是无头模式。
4. 用你真实的 Firefox 配置目录 → 已登录的账号都在，不会每次重新登录。
5. 搜索框选择依赖页面结构，通用网站在 bing/google/百度 上已验证；小众站点可能需要 `b.click()` 自己指定。

## 新增：模型自己上网（工具调用）

| 文件 | 作用 |
| --- | --- |
| `services/browser/tools.py` | 8 个工具定义（OpenAI function-calling 格式）+ 执行器 |
| `services/browser/agent.py` | `BrowserAgent`：指令 → 调工具 → 读结果 → 总结（最多 6 步） |
| `tools/browser_agent.py` | 命令行入口 |

工具列表：`browser_open` / `browser_search` / `browser_click` / `browser_type` /
`browser_read`（读正文）/ `browser_links`（列链接）/ `browser_screenshot` / `browser_close`。

用法：

```bat
.venv\Scripts\python.exe tools\browser_agent.py "在 Bing 搜索 AI 直播 弹幕 工具，告诉我前三条" --headless
.venv\Scripts\python.exe tools\browser_agent.py "打开 example.com 读一下页面内容" --headless
```

实测（DeepSeek deepseek-chat + headless Firefox）：

```
=== 结果 ===
Bing 搜索结果（前两条是广告，之后是自然结果）：
1. 知乎专栏《弹幕互动游戏AI无人直播》— 可遇AI直播助手，弹幕游戏无人直播
2. GitHub - PEPETII/danmuai — 开源 AI 主播 + AI 读弹幕，可配模型
3. danmuai.xyz - DanmuAI — Windows 桌面 AI 弹幕助手，截屏+视觉模型+Qt 浮层
注：页面最上方两条为广告（Kimi K3.1 Pro、光圈智播），未计入。
```

## 新增：headless 开关

`resources/config.yaml`：

```yaml
service:
  browser:
    headless: False   # True = 不弹窗口（无人值守）
```

命令行也能临时开：`--headless`。

## 新增：读页面

```python
b.read_text(max_chars=4000)   # 可见正文，已去空行、自动截断
b.read_links(limit=20)        # [{'text':..., 'href':...}]
```

## 语音指令（更新）

| 说的话 | 动作 |
| --- | --- |
| 打开浏览器 | 打开 Bing |
| 网页搜索 XXX | 直接在当前页搜索 |
| 上网查 / 帮我查 / 搜一下 / 查一下 XXX | 让模型自己开浏览器查，后台线程执行，结果写进 playground 历史 |
| 关闭浏览器 | 退出 Firefox |

## 仍未做

- 把查询结果念出来（TTS）：需要把答案送进 TTS 队列，目前只写日志和 playground 历史
- 更聪明的点击策略（按文字找元素而不是只靠 CSS 选择器）
