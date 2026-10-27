/**
 * [local patch 2026-10-27] 长期记忆桥接：把 QQ 通道接进 dsh-plugin-memory。
 *
 * 记忆插件的写入/召回只发生在 DSH 会话事件上；QQ 桥走自己的聊天通道，
 * 所以这里用它的 HTTP 接口（/memory/api/ingest 与 /memory/api/search）补上：
 *   - 每轮回复后把「用户说了什么 + 她回了什么」写进记忆库
 *   - 每轮生成前召回相关记忆，拼成一小块提示
 */
const DEFAULT_BASE = 'http://127.0.0.1:3081/memory/api'

export class LongMemory {
  constructor({ baseUrl = DEFAULT_BASE, agentId = 'ayu', logger, timeoutMs = 1500, enabled = true, factCooldownHours = 3, recentLines = 2 } = {}) {
    this.baseUrl = baseUrl
    this.agentId = agentId
    this.logger = logger
    this.timeoutMs = timeoutMs
    this.lastBlocks = new Map()
    // 事实冷却：同一件事 3 小时内不再重复注入
    this.factCooldown = new Map()
    this.enabled = enabled !== false
    this.factCooldownMs = Math.max(1, factCooldownHours) * 3600000
    this.recentLines = Math.max(0, recentLines)
    this.busy = false
  }

  async #fetchJson(path, init) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal })
      if (!response.ok)
        return undefined
      return await response.json()
    }
    catch {
      return undefined
    }
    finally {
      clearTimeout(timer)
    }
  }

  /** 写一轮对话（不阻塞回复：调用方不需要 await）。 */
  async ingest(sessionId, messages) {
    const list = (Array.isArray(messages) ? messages : []).filter(item => typeof item?.text === 'string' && item.text.trim() !== '')
    if (list.length === 0)
      return
    const data = await this.#fetchJson('/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: this.agentId, sessionId, messages: list }),
    })
    if (data?.ok !== true)
      this.logger?.debug?.('qq-groupmate: 记忆写入失败（忽略）')
  }

  /** 召回与这句话相关的记忆（事实 + 跨会话归档）。 */
  async recall(query, limit = 4, session = '') {
    const text = String(query ?? '').trim()
    if (text === '')
      return { facts: [], archive: [], recent: [] }
    const qs = new URLSearchParams({ agent: this.agentId, q: text.slice(0, 200) })
    if (session !== '')
      qs.set('session', session)
    const data = await this.#fetchJson(`/recall?${qs.toString()}`)
    if (data?.ok !== true)
      return { facts: [], archive: [], recent: [] }
    return {
      facts: Array.isArray(data.facts) ? data.facts.slice(0, limit) : [],
      archive: Array.isArray(data.archive) ? data.archive.slice(0, 2) : [],
      recent: Array.isArray(data.recent) ? data.recent.slice(0, 3) : [],
    }
  }

  /** 拼成提示词里的一小块；没有命中就返回 undefined（不要留空占位）。 */
  async recallBlock(query, context = '', session = '') {
    if (this.enabled !== true)
      return undefined
    const merged = `${String(context ?? '').slice(-200)} ${String(query ?? '')}`.trim()
    const { facts: rawFacts, archive, recent } = await this.recall(merged, 4, session)
    const nowTs = Date.now()
    const facts = (rawFacts ?? []).filter((item) => {
      const key = `${session}:${item.id ?? item.title}`
      const last = this.factCooldown.get(key) ?? 0
      if (nowTs - last < this.factCooldownMs)
        return false
      this.factCooldown.set(key, nowTs)
      return true
    })
    if (facts.length === 0 && archive.length === 0 && recent.length === 0)
      return undefined
    const lines = [
      '# 仅供回答「刚才/别的群/上次」这类追问（别主动提，也别反复提）',
      '用法：他问到过去时，用其中一条简短回答一次就够，然后顺着往下聊；'
      + '同一件事不要反复复述，也不要把原话整段搬出来。这里没有的事，才说记不清。',
    ]
    // 先放「刚才在别处」的原话：这类最容易对上「你还记得刚才…」
    for (const item of recent) {
      const text = String(item.text ?? '').trim()
      if (text === '' || item.role === 'assistant')
        continue
      const where = String(item.sessionId ?? '').startsWith('qq:private:') ? '私聊' : '别的群'
      const who = String(item.sender ?? '').trim()
      lines.push(`- 刚才在${where}${who === '' ? '' : `（${who}）`}说：${text.slice(0, 100)}`)
    }
    const SKIP_TITLES = ['我最近的想法', '群友常用的梗', '她最近在关注', '她学到的说话方式']
    const usable = facts.filter(item => !SKIP_TITLES.some(kw => String(item.title ?? '').includes(kw)))
    const factBudget = recent.length > 0 ? 2 : 3
    for (const item of usable.slice(0, factBudget)) {
      const title = String(item.title ?? '').trim()
      const summary = String(item.summary ?? '').trim()
      if (title === '' && summary === '')
        continue
      lines.push(`- ${title}${summary === '' || summary === title ? '' : `：${summary}`}`)
    }
    if (lines.length <= 2)
      return undefined
    const text = lines.join('\n')
    // 同一会话 10 分钟内不重复注入同样的一块：说过一次就够了
    const key = session === '' ? this.agentId : session
    const prev = this.lastBlocks.get(key)
    const now = Date.now()
    if (prev !== undefined && prev.text === text && now - prev.at < 10 * 60 * 1000)
      return undefined
    this.lastBlocks.set(key, { text, at: now })
    return text
  }
}
