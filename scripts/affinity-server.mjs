/**
 * 好感度只读服务：给桌面端「拟人化」设置页读表用。
 * 只读 <QQ_HOME>\home\qq-groupmate\affinity.json，不写任何东西。
 * 监听 127.0.0.1:3082，允许本机跨域（设置页在 59305 等端口）。
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'

const FILE = '<QQ_HOME>\\home\\qq-groupmate\\affinity.json'
const PORT = 3082

function tierOf(score) {
  if (score >= 25) return '自己人'
  if (score >= 10) return '熟人'
  if (score >= 3) return '眼熟'
  if (score < 0) return '不爽'
  return '陌生'
}

function readAffinity() {
  if (!existsSync(FILE))
    return { ok: true, people: [], groups: [] }
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf8'))
    const people = Object.values(data.people ?? {}).map((person) => {
      const chats = Object.entries(person.chats ?? {})
      const name = String(person.name ?? '') || String(chats.find(([, chat]) => chat.name)?.[1]?.name ?? '')
      const score = Number(person.score ?? 0)
      return {
        qq: String(person.qq ?? ''),
        name,
        score,
        tier: tierOf(score),
        msgs: Number(person.msgs ?? 0),
        chats: chats.length,
        lastAt: Number(person.lastAt ?? 0),
      }
    }).sort((a, b) => b.score - a.score)
    const groups = Object.entries(data.groups ?? {}).map(([chatKey, table]) => ({
      chatKey,
      private: chatKey.startsWith('private:'),
      members: Object.entries(table).map(([qq, record]) => ({
        qq,
        name: String(record.name ?? ''),
        score: Number(record.score ?? 0),
      })).sort((a, b) => b.score - a.score),
    }))
    return { ok: true, people, groups }
  }
  catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error), people: [], groups: [] }
  }
}

const GROWTH_FILE = '<QQ_HOME>\\home\\qq-groupmate\\card-growth.json'
const CARD_FILE = '<QQ_HOME>\\home\\qq-groupmate\\characters\\dafeiyu.json'
const PERSONA_STORE = '<DSH_HOME>\\storages\\dsh-persona-dafeiyu\\personas.json'
const SYNC_SCRIPT = '<USER_HOME>\\ayu-sync-cards.mjs'
const NODE_EXE = '<USER_HOME>\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\primary-runtime\\dependencies\\node\\bin\\node.exe'

/** 两张人格卡的同步状态（只读）。 */
function readCards() {
  const out = {
    ok: true,
    qq: { name: '', chars: 0, updatedAt: 0 },
    desktop: { name: '', chars: 0, updatedAt: 0, synced: false },
  }
  try {
    const card = JSON.parse(readFileSync(CARD_FILE, 'utf8'))
    out.qq = {
      name: String(card.name ?? ''),
      chars: String(card.extraPrompt ?? '').length,
      updatedAt: statSync(CARD_FILE).mtimeMs,
    }
  }
  catch {}
  try {
    const store = JSON.parse(readFileSync(PERSONA_STORE, 'utf8'))
    const target = (store.personas ?? []).find(item => String(item?.name ?? '').startsWith('大肥鱼（B站学习中）'))
    out.desktop = {
      name: String(target?.name ?? store.current ?? ''),
      chars: String(target?.text ?? '').length,
      updatedAt: statSync(PERSONA_STORE).mtimeMs,
      synced: target !== undefined && statSync(PERSONA_STORE).mtimeMs >= out.qq.updatedAt,
    }
  }
  catch {}
  return out
}

/** 人格卡学习记录（只读）。 */
function readGrowth() {
  try {
    if (!existsSync(GROWTH_FILE))
      return { ok: true, versions: [] }
    const data = JSON.parse(readFileSync(GROWTH_FILE, 'utf8'))
    const versions = Array.isArray(data.versions) ? data.versions.slice(-30).reverse() : []
    return { ok: true, versions }
  }
  catch {
    return { ok: true, versions: [] }
  }
}

createServer((req, res) => {
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'cache-control': 'no-store',
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers)
    res.end()
    return
  }
  const url = String(req.url ?? '/')
  if (url.startsWith('/cards')) {
    res.writeHead(200, { ...headers, 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(readCards()))
    return
  }
  if (url.startsWith('/sync') && req.method === 'POST') {
    try {
      const child = spawn(NODE_EXE, [SYNC_SCRIPT], { detached: true, stdio: 'ignore' })
      child.unref()
      res.writeHead(200, { ...headers, 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, started: true }))
    }
    catch (error) {
      res.writeHead(500, { ...headers, 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: String(error) }))
    }
    return
  }
  if (url.startsWith('/growth')) {
    res.writeHead(200, { ...headers, 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(readGrowth()))
    return
  }
  if (!url.startsWith('/affinity')) {
    res.writeHead(404, headers)
    res.end('not found')
    return
  }
  res.writeHead(200, { ...headers, 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(readAffinity()))
}).listen(PORT, '127.0.0.1', () => {
  console.log(`affinity server on http://127.0.0.1:${PORT}/affinity`)
})
