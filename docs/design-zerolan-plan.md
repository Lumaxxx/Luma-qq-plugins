# ZerolanLiveRobot 学习笔记 & 落地到阿圆的方案

> 调研：2026-10-23　对象：`<ZEROLAN_DIR>`（MIT，Python 3.10~3.11，AI VTuber 框架）
> 作者：赤川鹤鸣。核心组成：ZerolanLiveRobot（控制框架）+ ZerolanCore（AI 推理 HTTP 服务）+ ZerolanData（协议）+ Live2D/Unity/OBS/Minecraft 插件

## 一、它是什么

一句话：**把「感知 → 决策 → 表达」拆成事件，用管线把 AI 能力接进来。**

```
麦克风/屏幕/弹幕/QQ ──► Event（TypedEventEmitter 总线）──► 监听器
                                                        │
                    ASR / OCR / ImgCap / LLM / TTS / 向量库（HTTP 管线）
                                                        │
        Live2D 口型 / 扬声器 / OBS 字幕 / QQ 回复 / Minecraft 动作
```

- 没有事件就没有动作（纯事件驱动）
- 所有 AI 能力都是 HTTP 服务（`pipeline/`），可换成本地模型或第三方 API
- 服务都是可插拔的：`live_stream`（B站/YouTube/Twitch）、`qqbot`（NapCat）、`obs`、`live2d`、`browser`、`game/minecraft`、`playground`（Unity AR）

## 二、值得学的 6 个设计

### 1. 分级记忆 + 「什么时候写长期记忆」的评分
`bot.py:438 exp_memory()`

```python
t_memory = 0.3 * (max_history - len_history) / max_history
         + 0.2 * sentiment_score(text)
         + 0.2 * filter.match(response)   # 命中的违禁词数（说明话题敏感）
         + 0.1 * memory_score(response)
return t_memory > 0.5        # 超过阈值才把这段写进长期记忆
```

含义：**历史越空、情绪越强、话题越敏感、越"值得记"，才写进向量库**——不是每句都存。

长期记忆写入：`bot.py:501 save_memory()` → `summary_history(history)` 摘要后塞 Milvus。
检索：对话里出现「记得」→ 向量搜索 top2，把原文拼回 prompt（`bot.py:255`）。

### 2. 向量记忆（Milvus）
`pipeline/db/milvus/*`：`history_collection`，字段 `history`/`text`，`search(limit=2)`。
重依赖，但思路可借鉴：**语义检索 > 关键词**。

### 3. 情绪 → 语音风格
`manager/tts_prompt_manager.py`：参考音频按 `[语言][情绪]台词.wav` 命名，回答先做情感分类（`sentiment_analyse`），再选对应情绪的参考音频去 TTS。
→ 同一个角色，开心/难过/生气是**不同音色**。

### 4. 弹幕选择策略
`services/live_stream/bilibili.py`：弹幕进队列，`select_max_long_one()` 取出**最长的一条**回复（信息量最大）。原始代码里还有注释掉的「每 5 秒挑一条」逻辑。

### 5. 角色约束（过滤 + 注入历史）
- `character/filter/strategy.py`：违禁词 `FirstMatchedFilter`，命中直接丢弃回复
- `character/config.py` 的 `injected_history`：手写几轮「示例对话」注入为历史，比 system prompt 里的例子更管用
- `LLMPromptManager.reset_history()`：超过 `max_history` 就重置回注入历史（防止上下文无限膨胀）

### 6. 多平台抽象
`services/*` 每个平台一个服务，事件统一 `LiveStreamDanmakuEvent{platform, danmaku}`，上层不关心来源。
→ 同一个"人格"可以同时接 B 站直播、QQ 群、YouTube。

## 三、和现在的阿圆对照

| 能力 | Zerolan | 阿圆现状 | 结论 |
| --- | --- | --- | --- |
| QQ 接入 | NapCat + ncatbot | NapCat + 自研 OneBot 插件 | ✅ 已有，且更可控 |
| 短期记忆 | max_history + 重置 | 60 轮上下文 | ✅ 已有 |
| 中期记忆 | 无（直接向量化） | memory/chunks 按小时归档 + `[回忆:]` | ✅ 有，检索偏弱 |
| 长期记忆 | Milvus 向量库 | people 档案 + 好感度（非语义） | ⚠️ 缺语义检索 |
| 写入判定 | 0.3/0.2/0.2/0.1 评分 | 每 40 条总结一次 | ⚠️ 可借鉴 |
| 情绪表达 | 情感分类 → TTS 音色 | 文字语气（情绪靠提示词） | ⚠️ 缺结构化情绪 |
| 表情包 | 无 | 31 张 + `[表情:]` + 冷却 | ✅ 更强 |
| 识图认梗 | OCR + ImgCap | vision + 自动查梗 | ✅ 更强 |
| 人格演化/关系 | 无 | 好感度/黑话/演化/角色卡写回 | ✅ 独有 |
| 语音 | TTS（GPT-SoVITS 参考音） | 插件支持但关闭 | ⚠️ 可开 |
| 直播弹幕 | 原生支持 B 站 | 无 | ❌ 缺 |
| Live2D/OBS | 原生 | 无 | ❌ 缺 |

**结论**：阿圆在人设/社交/识图/斗图上已经比 Zerolan 强；差的是**语义记忆**和**结构化情绪**，另外可选项是**直播弹幕**。

## 四、落地方案

### P0（最值得做，约 2~3 天）

#### 1. 语义记忆检索（替代纯关键词）
- 新增 `lib/memory-vector.js`：给 `memory/chunks/*.json` 的每条消息算 embedding，存本地 `memory/vectors.sqlite`（sqlite 自带，无需 Milvus）
- 检索：消息里出现「记得 / 上次 / 以前 / 那个…」→ 自动 top3 注入上下文（不再依赖模型主动写 `[回忆:]`）
- 落地文件：`qq-groupmate/lib/memory-vector.js`（新）、`group.js` 的 `buildContext`（注入点）
- 成本：embedding 调用每条约 50~100 token，可只对"值得记"的消息算
- 验证：私聊说一件独特的事（如"我昨天买了蓝色水杯"），隔 2 小时在群里问「记得我说过什么吗」

#### 2. 借它的「记忆写入评分」
- 把 `t_memory` 公式搬进 `group.js`：历史长度 + 情绪词 + 敏感词 + 新信息密度 → 决定是否写入长期记忆
- 好处：省 embedding 费用，且记忆质量更高

#### 3. 结构化情绪标签
- 在回复协议里加 `[情绪:开心|难过|生气|惊讶|平静]`（和 `[表情:]` 同层解析），模型输出
- 用途：① 选表情包分类；② 未来接 TTS 选音色；③ 存进 people 档案"最近一次情绪"
- 零额外成本（同一次生成）

### P1（可选，3~5 天）

#### 4. B 站直播弹幕接入
- 新增 `lib/live-bilibili.js`：订阅直播间弹幕（用 `bilibili-api` 的 Python 侧？我们是 Node，用 WebSocket 协议实现或起一个 Python 小进程桥接）
- 弹幕 → 复用现有触发/回复逻辑；礼物/SuperChat 单独处理
- 需要你提供：直播间号、B 站 SESSDATA（可选）
- 风险：B 站风控、弹幕量大时费用飙升 → 必须有速率限制

#### 5. 语音回复（GPT-SoVITS）
- `dsh-plugin-qq-groupmate` 自带 voice/gpt-sovits 配置（现在关闭）
- 需要本地跑 GPT-SoVITS 服务（吃显存），或租 TTS API
- 建议先做「特定场景才发语音」（被点名/生日/哄人），不要每条都发

### P2（大工程，视需求）

#### 6. Live2D + OBS 字幕
- 需要 Live2D 模型 + `live2d-py` + OpenGL；和 QQ 群场景关联不大，更适合做直播
- 若真要做直播，建议**直接部署 Zerolan** 而不是自己重写

## 五、不建议照搬

| 组件 | 原因 |
| --- | --- |
| Milvus | 需要 Docker/独立服务，本地 sqlite+向量足够 |
| ZerolanCore 全家桶 | 我们已用 DeepSeek API，不需要本地 LLM 服务 |
| ASR/麦克风/热键 | QQ 群里用不上 |
| Minecraft 智能体 | 与当前需求无关 |
| 事件总线（TypedEventEmitter） | 我们的插件已是事件回调，重构收益低 |

## 六、需要你拍板的

1. **要不要做语义记忆**（P0-1）？这是最大收益项，但要花 embedding 钱（预估 < 1 元/天）
2. **要不要接 B 站直播**？需要直播间信息，且要做限流
3. **要不要语音**？要本地 GPU 跑 GPT-SoVITS，或换云端 TTS
4. 情绪标签要不要做？（零成本，建议做）

## 七、参考

- 项目：`<ZEROLAN_DIR>`（README 有完整功能列表）
- 关键文件：`bot.py`（事件处理/记忆判定）、`services/live_stream/bilibili.py`（弹幕）、`manager/tts_prompt_manager.py`（情绪音色）、`manager/llm_prompt_manager.py`（上下文重置）、`character/filter/strategy.py`（过滤）
