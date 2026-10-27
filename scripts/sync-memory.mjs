/**
 * 把「历史对话 + 学习成果 + 关系/黑话/群友档案」汇进 dsh-plugin-memory。
 *
 * 用法（桥运行时可跑，重复跑不会重复记）：
 *   node C:\Users\pc\dsh-qq\sync-memory.mjs            # 增量
 *   node C:\Users\pc\dsh-qq\sync-memory.mjs --full     # 重新扫全部历史
 *
 * 数据来源：
 *   <BOT>\\state.json            历史对话（群 + 私聊，按 seq 增量）
 *   <BOT>\\bili-memes.json       B站学到的兴趣 / 说话方式 / 梗
 *   <BOT>\\slang.json            群黑话
 *   <BOT>\\affinity.json         好感度（只同步 score>=3 的熟人）
 *   <BOT>\\people\\events.json   记忆蒸馏事件
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const QQ_HOME = process.env.DSH_QQ_HOME ?? join(homedir(), 'dsh-qq')
const BOT = join(QQ_HOME, 'home', 'qq-groupmate')
const API = 'http://127.0.0.1:3081/memory/api'
const AGENT = 'ayu'
const CURSOR = join(BOT, 'memory-sync-state.json')
const BATCH = 20
const MAX_PER_KEY = 400

function readJson(path, fallback) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback
  }
  catch {
    return fallback
  }
}

async function post(path, body) {
  try {
    const response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await response.json()
  }
  catch (error) {
    return { ok: false, error: String(error) }
  }
}

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size)
    out.push(list.slice(i, i + size))
  return out
}

function sessionIdOf(key) {
  return key.startsWith('private:') ? `qq:private:${key.slice('private:'.length)}` : `qq:group:${key}`
}

async function syncHistory(cursor, full) {
  const state = readJson(join(BOT, 'state.json'), { groups: {} })
  const groups = state.groups ?? {}
  // 实时写入的记忆库可能有更新的消息：先读各会话最大时间戳，避免重复灌入
  const lastTs = new Map()
  try {
    const db = new DatabaseSync(process.env.DSH_MEMORY_DB ?? join(QQ_HOME, 'home', 'storages', 'dsh-memory', 'memory-ayu.db'), { readOnly: true })
    for (const row of db.prepare('SELECT session_id AS s, MAX(ts) AS t FROM session_context GROUP BY session_id').all())
      lastTs.set(row.s, Number(row.t))
    db.close()
  }
  catch { /* 没有库就全量同步 */ }
  let ingested = 0
  let touched = 0
  for (const [key, value] of Object.entries(groups)) {
    const history = Array.isArray(value?.history) ? value.history : []
    if (history.length === 0)
      continue
    const since = full ? 0 : Number(cursor[key] ?? 0)
    const seenTs = lastTs.get(sessionIdOf(key)) ?? 0
    const fresh = history.filter(item => Number(item.seq ?? 0) > since && Number(item.time ?? 0) > seenTs)
    if (fresh.length === 0)
      continue
    const slice = fresh.slice(-MAX_PER_KEY)
    const sessionId = sessionIdOf(key)
    for (const batch of chunk(slice, BATCH)) {
      const messages = batch
        .filter(item => typeof item.text === 'string' && item.text.trim() !== '')
        .map(item => ({
          role: item.role === 'assistant' ? 'assistant' : 'user',
          text: String(item.text).slice(0, 2000),
          sender: item.speaker ?? undefined,
          ts: Number(item.time ?? Date.now()),
        }))
      if (messages.length === 0)
        continue
      const result = await post('/ingest', { agentId: AGENT, sessionId, messages })
      if (result?.ok === true)
        ingested += messages.length
    }
    cursor[key] = Math.max(...history.map(item => Number(item.seq ?? 0)))
    touched += 1
  }
  return { ingested, touched }
}

async function remember(title, summary, category = 'observation', fullText) {
  const result = await post('/remember', { agentId: AGENT, title, summary, category, fullText })
  return result?.ok === true ? (result.result?.action ?? 'ok') : 'failed'
}

async function syncLearning() {
  const memes = readJson(join(BOT, 'bili-memes.json'), {})
  let n = 0
  for (const interest of (memes.interests ?? []).slice(-8)) {
    await remember('她最近在关注', String(interest).slice(0, 120), 'observation')
    n += 1
  }
  for (const style of (memes.style ?? []).slice(-6)) {
    await remember('她学到的说话方式', String(style).slice(0, 120), 'belief')
    n += 1
  }
  for (const meme of (memes.memes ?? []).slice(-10)) {
    const term = String(meme?.term ?? '').trim()
    const meaning = String(meme?.meaning ?? '').trim()
    if (term)
      { await remember(`群友常用的梗：${term}`, meaning || '（暂无解释）', 'world_fact'); n += 1 }
  }

  const slang = readJson(join(BOT, 'slang.json'), { groups: {} })
  for (const [gid, terms] of Object.entries(slang.groups ?? {})) {
    for (const [term, info] of Object.entries(terms ?? {}).slice(0, 12)) {
      const meaning = String(info?.meaning ?? '').slice(0, 120)
      if (meaning)
        { await remember(`群 ${gid} 的黑话：${term}`, meaning, 'world_fact'); n += 1 }
    }
  }

  const affinity = readJson(join(BOT, 'affinity.json'), { people: {} })
  for (const [qq, person] of Object.entries(affinity.people ?? {})) {
    const score = Number(person?.score ?? 0)
    if (score < 3)
      continue
    const name = String(person?.name ?? qq)
    const tier = score >= 25 ? '自己人' : score >= 10 ? '熟人' : '眼熟'
    await remember(`和 ${name}（${qq}）的关系`, `${tier}，好感度 ${score}，聊过 ${person?.msgs ?? 0} 条`, 'belief')
    n += 1
  }

  const events = readJson(join(BOT, 'people', 'events.json'), { events: [] })
  for (const event of (events.events ?? []).slice(-40)) {
    const text = String(event?.text ?? '').trim()
    if (text)
      { await remember('群友档案', text.slice(0, 120), 'world_fact', text); n += 1 }
  }
  return n
}

async function main() {
  const full = process.argv.includes('--full')
  const cursor = readJson(CURSOR, {})
  const history = await syncHistory(cursor, full)
  writeFileSync(CURSOR, `${JSON.stringify(cursor, null, 2)}\n`, 'utf8')
  const facts = await syncLearning()
  console.log(JSON.stringify({ ok: true, historyIngested: history.ingested, scopes: history.touched, factsAttempted: facts }, null, 2))
}

main().catch((error) => {
  console.error('sync failed:', error)
  process.exit(1)
})
