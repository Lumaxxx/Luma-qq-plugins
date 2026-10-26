/**
 * [local patch 2026-10-25] 外挂写回历史的队列
 *
 * 场景：dsh-qq-amem 这类外挂会「以阿圆的名义」发消息（主动发言等），
 * 但那些消息不经过本插件，历史里没有它 → 群友回话时阿圆不知道自己说过什么。
 *
 * 做法：外挂把要写的条目按 JSONL 追加到本文件，插件每 15 秒 drain 一次，
 * 交给 manager.appendHistory 写进对应会话历史。
 *
 * 行格式：{"scope":"<GROUP_ID>","role":"assistant","speaker":"阿圆","text":"...","time":123}
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export class ExternalHistoryQueue {
  constructor({ file, logger }) {
    this.file = file
    this.logger = logger
  }

  /** 外挂侧也用它：追加一条待写入的历史。 */
  push(entry) {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8')
      return true
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 外部历史入队失败：%s', String(error))
      return false
    }
  }

  /** 取出全部条目并清空文件。 */
  drain() {
    if (!existsSync(this.file))
      return []
    let raw = ''
    try {
      raw = readFileSync(this.file, 'utf8')
      writeFileSync(this.file, '', 'utf8')
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 外部历史读取失败：%s', String(error))
      return []
    }
    const items = []
    for (const line of raw.split('\n')) {
      const text = line.trim()
      if (text === '')
        continue
      try {
        const parsed = JSON.parse(text)
        if (parsed !== null && typeof parsed === 'object' && typeof parsed.scope === 'string' && typeof parsed.text === 'string')
          items.push(parsed)
      }
      catch {
        // 坏行忽略
      }
    }
    return items
  }
}
