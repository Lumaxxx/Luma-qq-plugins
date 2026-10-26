# 设计 B：给阿圆加的小接口（四项能力）

> 2026-10-25 实施。参考 AstrBot 实战日志的坑。
> 全部为**新增文件 + 少量接入**，默认开启；出问题可逐项关闭。

## 1. 情绪系统（`lib/mood.js`）

- **事件驱动**：只有「真的冲它来」的消息才改心情
  - 被夸 → 开心（0.7，持续 4 小时）
  - 被怼/被骂（含别名或回复它）→ 不爽（0.8，4 小时）
  - 被追问/刁难（含问号且消息够长）→ 不耐烦（0.5，4 小时）
- **按时过期**：读取时实时判断，过期自动丢弃（AstrBot 的 bug 就是这里没做）
- **只影响语气**：注入段落明确写「事实、结论、人设底线不变；不要把火气撒到无关的人身上；不要主动说自己什么心情」
- **可清空**：`MoodStore.clear(scope)`
- 存储：`qq-groupmate/mood.json`
- 配置：`mood.enabled`、`mood.durationHours`（默认 4）

单元测试结论：夸→开心、怼→不爽、无关消息不改、过期返回 null、清空生效。

## 2. 表情包写回历史（`outbound.js` + `group.js`）

- 发完表情后记录名字（`lastStickers` per scope）
- 写历史时附注：`（我刚发了一张表情包：<名字>）`
- 效果：下一轮模型知道自己刚发过图，不会重复发或说"我没发图"

## 3. 主动发言写回历史（`lib/external-history.js`）

- 外挂（`dsh-qq-amem`）发完主动消息后，往 `external-history.jsonl` 追加一行
- 插件每 15 秒合并进对应会话历史（`manager.appendHistory`）
- 已实测：注入一条后被正确写入 `state.json`，日志 `已合并 1 条外部写回的历史`

## 4. 守卫：禁言检测 + 回复频率上限

- **禁言检测**（`isMutedInGroup`）：回复前查一次 `get_group_member_info` 的 `shut_up_timestamp`，
  被禁言就不生成（省 token）；缓存 20 秒，查询失败一律放行
- **频率上限**（`allowReplyRate`）：每群每分钟最多 `guard.maxRepliesPerMinute` 条（默认 4，0=不限），
  防止「关键词窗口期内每条都回」
- 配置：`guard.muteCheck`、`guard.muteCacheSeconds`、`guard.maxRepliesPerMinute`

## 配置位置

`<QQ_HOME>\home\profiles\web\cordis.patch.yml`：

```yaml
    mood:
      enabled: true
      durationHours: 4
    guard:
      muteCheck: true
      muteCacheSeconds: 20
      maxRepliesPerMinute: 4
```

## 怎么验证

1. **情绪**：群里夸它一句（「阿圆真厉害」）→ 接下来语气会偏开心；骂它一句 → 偏不爽；4 小时后自动消失
2. **表情历史**：让它发一次表情包，之后问「你刚才发了什么」→ 它应该记得
3. **主动发言历史**：等它主动说一句，再回一句 → 它应该接得上，不会答非所问
4. **限流**：十分钟内连艾特它 10 次 → 每分钟最多回 4 条

## 回滚

| 能力 | 关闭方法 |
| --- | --- |
| 情绪 | `mood.enabled: false` |
| 禁言检测 | `guard.muteCheck: false` |
| 限流 | `guard.maxRepliesPerMinute: 0` |
| 外部历史合并 | 停用外挂 dsh-qq-amem |
| 表情注记 | 删除 `group.js` 里 `takeStickers` 那两段（有 `[local patch 2026-10-25]` 标记） |
