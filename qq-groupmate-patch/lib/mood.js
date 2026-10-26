/**
 * [local patch 2026-10-25] 情绪系统（事件驱动 + 时效 + 可清空）
 *
 * 参考 AstrBot 实战日志的教训：
 *   - 情绪必须**按时间过期**（他们配置了 mood_persistence_hours 却不生效，情绪永远挂着）
 *   - 情绪必须**由事件触发**（被夸/被骂/被刁难），不要每天随机塞底色
 *   - 情绪的负面浓度不能扩散到无关的人
 *
 * 这里只存「一个当前心情」，scope 级（群/私聊各自独立）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const PRAISE = ['厉害', '牛', '强', '好棒', '真棒', '喜欢', '爱你', '可爱', '聪明', '谢谢', '辛苦了', '绝了', '靠谱']
const INSULT = ['滚', '滚吧', '滚开', '烦', '讨厌', '蠢', '笨蛋', '菜', '闭嘴', '垃圾', '废物', '死鱼', '矮鱼', '丑', 'fuck', 'fw', 'FW']

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export class MoodStore {
  constructor({ file, settings, logger }) {
    this.file = file
    this.settings = settings ?? {}
    this.logger = logger
    this.moods = {}
    this.load()
    this.prune()
  }

  load() {
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
        if (parsed !== null && typeof parsed === 'object' && parsed.moods !== null && typeof parsed.moods === 'object')
          this.moods = parsed.moods
      }
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 情绪文件读取失败，按空表继续：%s', String(error))
    }
  }

  persist() {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify({ version: 1, moods: this.moods }, null, 1), 'utf8')
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 情绪保存失败：%s', String(error))
    }
  }

  /** 丢掉过期心情（AstrBot 的 bug 就是这里没做）。 */
  prune(now = Date.now()) {
    let changed = false
    for (const [scope, mood] of Object.entries(this.moods)) {
      if (!mood || Number(mood.expiresAt ?? 0) <= now) {
        delete this.moods[scope]
        changed = true
      }
    }
    if (changed)
      this.persist()
  }

  /** 事件触发：只有在「真的冲它来」的时候才改变心情。 */
  observe(scope, { text = '', aliases = [], addressed = false } = {}) {
    if (this.settings.enabled === false)
      return
    const key = String(scope ?? '')
    if (key === '')
      return
    const content = String(text ?? '')
    if (content === '')
      return
    const lower = content.toLowerCase()
    const mentionsSelf = addressed === true || aliases.some(alias => alias !== '' && lower.includes(String(alias).toLowerCase()))
    if (!mentionsSelf)
      return

    const durationHours = Math.max(0.25, Number(this.settings.durationHours ?? 4))
    const now = Date.now()
    let emotion
    let intensity
    let reason
    if (INSULT.some(word => lower.includes(word.toLowerCase()))) {
      emotion = '不爽'
      intensity = 0.8
      reason = '被怼了'
    }
    else if (PRAISE.some(word => lower.includes(word.toLowerCase()))) {
      emotion = '开心'
      intensity = 0.7
      reason = '被夸了'
    }
    else if (/[?？]/u.test(content) && content.length > 12) {
      emotion = '不耐烦'
      intensity = 0.5
      reason = '被追问/刁难'
    }
    else {
      return
    }
    this.moods[key] = {
      emotion,
      intensity: clamp(intensity, 0, 1),
      reason,
      createdAt: now,
      expiresAt: now + durationHours * 3600_000,
    }
    this.persist()
    this.logger?.debug?.('qq-groupmate: 情绪更新 %s -> %s（%s）', key, emotion, reason)
  }

  current(scope) {
    this.prune()
    return this.moods[String(scope ?? '')]
  }

  /** 拼进提示词的一段；没有心情时返回 null。 */
  describe(scope) {
    const mood = this.current(scope)
    if (mood === undefined)
      return null
    const leftMinutes = Math.max(1, Math.round((mood.expiresAt - Date.now()) / 60_000))
    const tone = mood.emotion === '爽快'
      ? ''
      : mood.intensity >= 0.7 ? '语气明显一点，但别演过头' : '轻微带一点'
    return `# 你现在的心情\n【${mood.emotion}】（${mood.reason}，还会持续约 ${leftMinutes} 分钟）。`
      + `心情只影响语气，${tone}；事实、事实性结论和人设底线不变。`
      + '不要主动说出「我现在心情怎样」，也不要把火气撒到无关的人身上。'
  }

  clear(scope) {
    const key = String(scope ?? '')
    if (this.moods[key] !== undefined) {
      delete this.moods[key]
      this.persist()
      return true
    }
    return false
  }
}
