/**
 * [local patch 2026-10-26] B站学到的梗库
 *
 * 由 <USER_HOME>\ayu-learn.py 每天生成/更新到 qq-groupmate/bili-memes.json，
 * 这里按文件 mtime 懒加载，聊天时注入一小段「可以用但别解释来源」的说法。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'

export class BiliMemes {
  constructor({ file, logger }) {
    this.file = file
    this.logger = logger
    this.data = undefined
    this.mtime = 0
  }

  load() {
    if (!existsSync(this.file))
      return undefined
    try {
      const info = statSync(this.file)
      if (this.data !== undefined && info.mtimeMs === this.mtime)
        return this.data
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      this.data = parsed !== null && typeof parsed === 'object' ? parsed : {}
      this.mtime = info.mtimeMs
      return this.data
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 梗库读取失败：%s', String(error))
      return this.data
    }
  }

  /** 拼一小段供提示词使用；没有内容就返回 null。 */
  formatForPrompt(limit = 6) {
    const data = this.load()
    if (data === undefined)
      return null
    const memes = Array.isArray(data.memes) ? data.memes.slice(-limit) : []
    const style = Array.isArray(data.style) ? data.style.slice(0, 3) : []
    const interests = Array.isArray(data.interests) ? data.interests.slice(0, 3) : []
    if (memes.length === 0 && style.length === 0 && interests.length === 0)
      return null
    const lines = ['# 你在 B 站学到的说法（聊天时可以用，别解释来源、别炫耀）']
    if (memes.length > 0) {
      lines.push('梗：')
      for (const meme of memes) {
        const term = String(meme.term ?? '').trim()
        if (term === '')
          continue
        const meaning = String(meme.meaning ?? '').trim()
        lines.push(`- ${term}${meaning === '' ? '' : `：${meaning}`}`)
      }
    }
    if (style.length > 0)
      lines.push(`说话方式：${style.join('；')}`)
    if (interests.length > 0)
      lines.push(`最近关注：${interests.join('、')}`)
    lines.push('用得自然一点，用不上就别硬塞；一次回复最多用一个梗。')
    return lines.join('\n')
  }
}
