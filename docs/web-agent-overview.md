# 阿圆上网（browser-use）：通用搜索，不限于 B 站

更新时间：2026-10-26

## 它是什么

`browser-use` 0.1.40 + 系统 Edge（CDP），让模型自己操作真实浏览器：
看页面 → 决定点哪/输什么 → 看结果 → 再决定，直到完成任务。

不是录好的脚本，是**每个任务现想现做**。

## 位置与启动

```
<WEBAGENT_HOME>\
├── .venv\                 Python 3.11 + browser-use + playwright
├── run_ayu.py             入口
├── edge-profile\          浏览器数据（登录状态保留）
└── last_result.txt        最近一次结果
```

运行前先关掉自己开的 Edge（脚本要独占 `127.0.0.1:9222`）。

## 五种用法

```bat
cd <WEBAGENT_HOME>

:: 1. 通用搜索（自己挑搜索引擎）
.venv\Scripts\python.exe run_ayu.py search "Rust 1.80 有什么新特性"

:: 2. 问答/调研（自己找可信网站，至少两个来源）
.venv\Scripts\python.exe run_ayu.py ask "2026 年诺贝尔经济学奖颁给谁，贡献是什么"

:: 3. 打开指定网站看内容
.venv\Scripts\python.exe run_ayu.py visit https://www.deepseek.com "把首页提到的模型和价格列出来"

:: 4. 自由探索（按兴趣自己决定去哪，2-3 个不同站）
.venv\Scripts\python.exe run_ayu.py explore

:: 5. 任意任务（一句话描述）
.venv\Scripts\python.exe run_ayu.py free "去京东搜 RTX 5070，把前三个自营店的型号和价格列出来"

:: 想看它怎么操作：加 --show（显示浏览器窗口）
.venv\Scripts\python.exe run_ayu.py --show search "AI 直播 弹幕 工具"
```

## 实测记录

| 任务 | 耗时 | 结果 |
| --- | --- | --- |
| 打开 example.com 报标题 | 10.3 s | ✅ |
| 按兴趣逛 B 站挑 3 条 | 30.9 s | ✅ |
| ask：2026 诺贝尔经济学奖 | 136.8 s | ✅ 访问 nobelprize.org + 百度百科交叉验证 |

最后那个任务的输出（节选）：

```
2026 年诺贝尔经济学奖授予罗伯特·E·霍尔（斯坦福）与迈克尔·伍德福德（哥伦比亚），
理由是 "for microeconomic foundations of macroeconomic stabilisation"（为宏观稳定政策奠定微观基础）。
依据：nobelprize.org（官方页面 + Popular information）、百度百科「2026年诺贝尔奖」词条。
（注：Google 与英文维基在当前网络环境下无法访问，故改用上述两个可访问来源交叉验证。）
```

它会自己说明哪些站点没打通，并换可访问的来源——这点挺像人。

## 技术要点（给以后维护的自己）

1. **Edge CDP**：自己拉 `msedge.exe --headless=new --remote-debugging-port=9222 --user-data-dir=...`，
   然后 `BrowserConfig(cdp_url="http://127.0.0.1:9222")`。
   ⚠️ 不要加 `--remote-debugging-address`（Edge 156 会起不来）。
2. **IPv6 坑**：browser-use 默认连 `localhost:9222` 会解析成 `::1`；用 `127.0.0.1` 显式指定。
3. **编码**：Windows 控制台 GBK 编码会因日志里的 emoji 抛 `UnicodeEncodeError`；
   `PYTHONIOENCODING=utf-8` + `reconfigure`。
4. **收尾卡死**：`agent.run()` 结束后清理浏览器会挂住；
   用 `register_done_callback` 里落盘 + `os._exit(0)` 解决。
5. **遥测**：设 `ANONYMIZED_TELEMETRY=false`，避免无谓外连。
6. **模型**：`langchain_openai.ChatOpenAI(model="deepseek-chat", base_url="https://api.deepseek.com/v1")`，
   `use_vision=False`（DeepSeek chat 不支持图像，不需要）。

## 限制

- 需要关掉正在用的 Edge（调试端口独占）
- 需要登录/验证码/滑块的站点会停在那一页（不会破解，符合预期）
- 每次运行有步数上限（默认 12，可用 `--max-steps` 调）
- 结果写在 `last_result.txt`，同时打印到控制台

## 设置页（LUMA）

「拟人化」已改名 **LUMA**，里面新增「上网（自己开浏览器查资料）」：

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 上网开关 | 开 | 关掉后群里说「查一下」她也不会去查 |
| 显示浏览器窗口 | 开 | 另开一个 Edge 窗口让你看着；关掉=后台隐身 |
| 最多几步 | 12 | 一次查询最多操作多少步 |
| 超时（分钟） | 4 | 超时放弃 |

配置落在 `<QQ_HOME>\social.json` 的 `web` 块，QQ 桥启动时读取。

## 下一步（未做）

- 接到阿圆 QQ 群：群里说「阿圆查一下 XXX」→ 调用 `run_ayu.py ask "XXX"` → 回复结果
- 定时任务：每天固定时间 `explore` 逛一圈，挑一条发群里
- 把 `last_result.txt` 的摘要塞进群聊上下文，让她能接着聊
