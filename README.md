# 阿圆 · QQ 群 AI 伙伴插件包

> 一个住在 QQ 群里、会聊天、会记人、会看图、会学习、会自己上网查资料的 AI 伙伴。
> 本仓库只包含**插件补丁、外挂、脚本与文档**，不含任何角色卡正文、聊天记录或个人数据。

---

## 目录

- [更新日志](CHANGELOG.md)
- [语言卫生设计](docs/language-hygiene.md)

- [它有什么](#它有什么)
- [架构](#架构)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
- [安装配置](#安装配置)
- [使用教程](#使用教程)
- [上网查询（browser-use）](#上网查询browser-use)
- [数据与隐私](#数据与隐私)
- [常见问题](#常见问题)
- [许可](#许可)

---

## 它有什么

| 能力 | 说明 |
| --- | --- |
| 关键词唤醒 | 不 @ 也能被叫出来（消息里出现角色名/别名即可） |
| 唤醒后自由对话窗口 | 唤醒后一段时间内继续接话，可调 |
| 好感度 | 以 **QQ 号为身份**跨群/私聊合并，被夸加分、被怼扣分、每日衰减 |
| 群黑话 | 只收群友自己给过的定义（「X 就是 Y」） |
| 人格演化 | 数据驱动演进，保留历史快照可回滚 |
| 学习写回角色卡 | 只改说话风格/性格，写前自动备份 |
| 情绪 | 被夸/被怼/被刁难时短暂改变语气，自动过期 |
| 守卫 | 被禁言不生成、每个群每分钟回复上限 |
| 识图 | 群友发图直接看，可配置识图模型 |
| 斗图 | 本地表情包，轮次+冷却节流 |
| 记忆蒸馏 | 定时把群聊里值得记的事写进长期记忆 |
| 主动发言 | 群里安静太久且未超每日上限时主动开口 |
| B 站学习 | 从刷到的视频/评论里提炼兴趣、梗、说话方式，累加进角色卡 |
| **自己上网** | 群里说「查一下 XXX」，开浏览器自己去搜、去读、回来总结 |
| **可视化设置页** | 桌面端「LUMA」面板：分 5 个页签，所有开关都在这里 |
| **识图加速** | 内容哈希缓存 / 本地 OCR / 多图拼图 / 表情包指纹匹配 |
| **长期记忆** | 接 DSH 记忆插件，跨群召回 + 冷却 + 使用惩罚 |
| **人格成长** | 用自己的话把学到的写进人格卡（不是关键词清单） |
| **语言卫生** | 防复读 / 词句权重治理：检测递增、硬删词句、语义自检、解码惩罚 |

---

## 架构

```
QQ 群 / 私聊
   │
   ▼
NapCat（QQNT 协议端，默认 WebUI 6099）
   │  OneBot 反向 WebSocket
   ▼
DSH 独立实例「QQ 桥」（Web 3081 · OneBot 3001）
   ├─ qq-groupmate     聊天主体（本仓库补丁）
   └─ dsh-qq-amem      外挂：记忆蒸馏 / 主动发言 / 学习调度
   │
   └─ HTTP → NapCat API 6098（外挂主动发言用）

桌面端 DSH
   ├─ dsh-qq-social    「LUMA」设置页
   └─ dsh-persona-dafeiyu  人设插件（可选，用于人格卡同步）

只读小服务 3082：好感度表 / 学习记录 / 两卡状态（设置页跨域读取）
上网：browser-use + 系统 Edge（CDP 9333）
```

---

## 目录结构

```
.
├── install-ayu.ps1              一键安装（Windows）
├── qq-groupmate-patch/lib/      聊天主体补丁（覆盖到 node_modules）
├── dsh-qq-amem/                 外挂插件
├── dsh-qq-social/               LUMA 设置页插件
├── web-agent/run_ayu.py         上网查询入口（browser-use）
├── scripts/
│   ├── ayu-learn.py             B 站学习
│   ├── ayu-sync-cards.mjs       人格卡同步（可选）
│   ├── affinity-server.mjs      3082 只读小服务
│   ├── supervise-bridge.ps1     守护：桥挂了自动拉起
│   └── start-*.cmd / *.vbs      启动脚本
├── configs/                     脱敏配置示例
│   ├── cordis.patch.example.yml
│   ├── dsh-qq-amem.example.yml
│   └── social.example.json
└── docs/                        设计说明
```

---

## 快速开始

### 前置条件

- Windows 10/11
- [DeepSeek Harness](https://deepseek-harness.github.io/)（桌面端 + 一个独立实例当 QQ 桥）
- [NapCat](https://napcat.napcat.wiki/)（QQNT 协议端）
- Python 3.10+（跑学习脚本与上网；带 `requests`、`pyyaml`）
- 一个专门的小号 QQ（别用主号）

### 安装

```powershell
# 1) 先装好 DSH 与 qq-groupmate，并让 QQ 桥 profile 里能看到
#    <QQ_HOME>\home\profiles\web\node_modules\dsh-plugin-qq-groupmate

# 2) 运行安装脚本（会提示输入 DeepSeek API Key）
powershell -ExecutionPolicy Bypass -File install-ayu.ps1 -GroupId <群号>

# 3) 启动
wscript "<QQ_HOME>\start-qq-hidden.vbs"
"<QQ_HOME>\start-bridge-supervisor.cmd"        # 建议设为开机启动

# 4) 重启桌面端 DSH，设置里会出现「LUMA」
```

安装脚本做的事：

1. 把 `qq-groupmate-patch/lib/` 覆盖进聊天插件
2. 安装外挂 `dsh-qq-amem` 并注册进桥 profile
3. 安装设置页 `dsh-qq-social` 并注册进桌面端 profile
4. 生成/合并桥配置（已有则备份不覆盖）
5. 把脚本写到 `<QQ_HOME>` 并替换占位符
6. Key 写进本地 `ayu-secret.env`（**不进仓库、不进配置文件**）

> ⚠️ 补丁都在 `node_modules` 里，重装插件会覆盖，升级前请先备份本仓库。

---

## 安装配置

### 桥配置 `<QQ_HOME>\home\profiles\web\cordis.patch.yml`

参考 `configs/cordis.patch.example.yml`。关键项：

```yaml
trigger:
  mention: true
  cooldownSeconds: 0
vision:
  enabled: true
  maxImages: 3
apiProviders:
  - id: vision-api-provider
    protocol: openai
    baseUrl: https://api.deepseek.com/v1
    apiKey: !!js process.env.DEEPSEEK_API_KEY || ''
models:
  - name: vision-api
    provider: vision-api-provider
    model: deepseek-flash
modelSlots:
  vision: { model: vision-api }
people: { surfaceTtlMinutes: 1440 }   # 私聊记忆在群里保留 24 小时
```

### 外挂配置 `dsh-qq-amem/cordis.patch.yml`

参考 `configs/dsh-qq-amem.example.yml`：

```yaml
memory:
  scanMinutes: 30        # 每 30 分钟蒸馏一次
  minNewMessages: 25
  maxEvents: 3
proactive:
  enabled: true
  groups: ['<GROUP_ID>']
  quietMinutes: 90       # 群里安静 90 分钟后可能开口
  maxPerDay: 2
  activeHours: [9, 23]
  apiBase: 'http://127.0.0.1:6098'
  apiToken: '<NAPCAT_HTTP_TOKEN>'
learn:
  enabled: true
  hour: 3
  minute: 30
  python: '<PYTHON_EXE>'
  script: '<QQ_HOME>\ayu-learn.py'
```

### 设置页 `LUMA`（写在 `<QQ_HOME>\social.json`）

```json
{
  "affinityEnabled": true,
  "slangEnabled": true,
  "personaEvolutionEnabled": true,
  "cardEvolutionEnabled": true,
  "triggerWindowMinutes": 5,
  "evolutionRefreshEvery": 60,
  "personaNote": "",
  "mood":   { "enabled": true, "durationHours": 4 },
  "guard":  { "muteCheck": true, "muteCacheSeconds": 20, "maxRepliesPerMinute": 4 },
  "vision": { "enabled": true, "model": "vision-api", "maxImages": 3 },
  "web":    { "enabled": true, "visible": true, "maxSteps": 12, "timeoutMinutes": 4 }
}
```

---

## 使用教程

### 1. 叫醒她

```
@阿圆 在吗
大肥鱼 今天吃什么
（唤醒后 5 分钟内直接说话她也会接）
```

### 2. 好感度

被夸 +2，被怼 −3，正常接话 +1，每天按半衰期衰减。设置页「好感度一览」能看全局排行和分群明细。

### 3. 看图

直接发图即可，默认最多一次看 3 张。识图模型在 LUMA 里可换。

### 4. 斗图

发 `[表情:开心]` 之类的标记（插件会自动节流：一轮最多一张、同会话 8 分钟冷却）。

### 5. B 站学习（可选）

刷 B 站的插件会把看过的视频记进 `seen.md` / `digest/`，学习脚本每天固定时间：

```
读数据 → 抓真实评论 → 提炼兴趣/梗/说话方式
  → 累加进梗库与角色卡（带去重、过滤攻击性词）
  → 记录版本（可回滚）
```

手动跑一次：

```powershell
"<PYTHON_EXE>" "<QQ_HOME>\ayu-learn.py"
# 想重置说话方式：
"<PYTHON_EXE>" "<QQ_HOME>\ayu-learn.py" --reset-style
```

### 6. 自己上网查资料

群里直接说（需要 @ 或带名字）：

```
@阿圆 查一下 深中通道什么时候通车
阿圆 帮我查 RTX 5070 现在的价格
大肥鱼 搜一下 Rust 最近的新特性
```

触发词：`查一下 / 查查 / 搜一下 / 搜索一下 / 帮我查 / 上网查 / 去查 / 搜索 / 查`

她会：

```
本鱼去查「深中通道 通车时间」，稍等…
（另开一个 Edge 窗口，自己搜索、点开结果、读页面）
本鱼查到：2024 年 6 月 30 日正式通车……（带来源）
```

LUMA 里可以控制：开关、是否显示窗口、最多几步、超时。

### 7. 主动发言

群里安静 90 分钟以上、在 9:00–23:00 之间、当天没超过 2 条时，她可能主动说一句。频道与频率在 `dsh-qq-amem` 配置里调。

---

## 上网查询（browser-use）

群里的「查一下」底层是 [browser-use](https://github.com/browser-use/browser-use)（推荐 0.1.40）+ 系统 Edge。

### 单独安装

```powershell
# 1) 建虚拟环境（3.11 最稳）
python -m venv C:\ayu-web-agent\.venv
C:\ayu-web-agent\.venv\Scripts\python.exe -m pip install -U pip
C:\ayu-web-agent\.venv\Scripts\python.exe -m pip install "browser-use==0.1.40" `
    -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com

# 2) 把 web-agent\run_ayu.py 放到 C:\ayu-web-agent\run_ayu.py

# 3) 自测
C:\ayu-web-agent\.venv\Scripts\python.exe C:\ayu-web-agent\run_ayu.py ask "DeepSeek 官网地址"
```

### 命令行用法

```bat
:: 通用搜索
run_ayu.py search "Rust 1.80 新特性"

:: 问答调研（自己找可信来源）
run_ayu.py ask "2026 年诺贝尔经济学奖颁给谁"

:: 打开指定网站
run_ayu.py visit https://www.deepseek.com "列出模型和价格"

:: 按兴趣自由探索
run_ayu.py explore

:: 任意任务
run_ayu.py free "去京东搜 RTX 5070，列前三个自营店价格"

:: 隐身（不弹窗口）
run_ayu.py --headless ask "..."
```

### 实现要点（踩过的坑）

1. **独立 profile**：脚本用自己的 `edge-profile`，不会影响你日常开的 Edge；
   调试端口用 `9333`，靠 `--remote-debugging-port` 起第二个实例。
2. **不要加 `--remote-debugging-address`**（Edge 156 会起不来）。
3. **别用 `localhost`**：会解析成 `::1`，连不上；用 `127.0.0.1`。
4. **编码**：Windows 控制台 GBK 会让日志里的 emoji 崩，需要 `PYTHONIOENCODING=utf-8`。
5. **收尾卡死**：`agent.run()` 结束后清理浏览器会挂住；
   用完成回调「先落盘 → 结束进程 → 退出」。
6. **遥测**：`ANONYMIZED_TELEMETRY=false`。

---

## 数据与隐私

**本仓库不包含**：

- 任何角色卡正文（人设文本）
- 群聊记录、好感度、群友档案、黑话词典
- B 站学习产物（梗库/风格/兴趣）
- API Key、QQ 号、群号、账号名、绝对路径

运行时数据都在本地，建议 `.gitignore` 掉：

```
characters/  people/  learned/  affinity.json  social.json
bili-memes.json  card-growth.json  *.log  state.json
ayu-secret.env  bili_credential.json
```

---

## 常见问题

| 现象 | 原因 / 办法 |
| --- | --- |
| 桥起不来，日志 `ECONNREFUSED 3001` | 桥实例挂了；看 `bridge-supervisor.log`，守护会自动拉起 |
| 每 1~2 分钟断一次 | 重复启动抢端口；只保留一个守护进程 |
| `serverErrorCode 168` | QQ 风控，停用等待恢复，别刷 |
| 识图返回空 | 视觉槽没指向可传图的 API（用 OpenAI 兼容协议） |
| 私聊记忆群里想不起 | `people.surfaceTtlMinutes` 调成 1440 |
| 「查一下」没反应 | LUMA 里上网开关关着；或没 @ 她 |
| 上网卡在第一步 | Edge 被占端口；脚本会用自己的 profile，若失败看 `last_result.txt` |
| 学习结果没变化 | 数据源 `seen.md`/`digest` 没新内容；或没配 key |

---

## 许可

- 本仓库自有代码：MIT
- 依赖的第三方插件（qq-groupmate、browser-use、DeepSeek Harness、NapCat 等）遵循各自许可，本仓库不重新分发其代码
- 仅用于小群自娱自乐，请勿用于骚扰、刷屏或违规用途
