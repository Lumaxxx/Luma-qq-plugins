/**
 * 两张人格卡同步（2026-10-26）
 *
 * 唯一依据：QQ 角色卡 qq-groupmate/characters/dafeiyu.json
 * 产出两处：
 *   1. 该卡自己的 extraPrompt 里「B站学到的」区块（ayu-learn 已经写过，这里只读）
 *   2. 「大肥鱼」人设插件（dsh-persona-dafeiyu）的人设库：把 QQ 卡渲染成 markdown 正文，
 *      走官方接口 import + set-current，桌面端下一个请求就用上（不用重启）
 *
 * 每次都先删旧的「大肥鱼（B站学习中）」再导入，保证人设列表里只有一条。
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const DESKTOP_HOME = '<DSH_HOME>'
const CARD = '<QQ_HOME>\\home\\qq-groupmate\\characters\\dafeiyu.json'
const MEMES = '<QQ_HOME>\\home\\qq-groupmate\\bili-memes.json'
const STORE = join(DESKTOP_HOME, 'storages', 'dsh-persona-dafeiyu', 'personas.json')
const PERSONA_NAME = '大肥鱼（B站学习中）'
const MARK_BEGIN = '<!--AYU:BILILEARN-->'
const MARK_END = '<!--/AYU:BILILEARN-->'
const API_STATUS = '/api/dsh-persona-dafeiyu/status'
const API_MUTATE = '/api/dsh-persona-dafeiyu/mutate'

function readJson(file, fallback) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback
  }
  catch {
    return fallback
  }
}

function stripMarked(text) {
  const source = String(text ?? '')
  if (!source.includes(MARK_BEGIN))
    return source.trim()
  const head = source.split(MARK_BEGIN)[0]
  const tailPart = source.split(MARK_BEGIN)[1] ?? ''
  const tail = tailPart.includes(MARK_END) ? tailPart.split(MARK_END)[1] ?? '' : ''
  return (head + tail).trim()
}

function learnedSection(memes) {
  const interests = Array.isArray(memes.interests) ? memes.interests.slice(-6) : []
  const style = Array.isArray(memes.style) ? memes.style.slice(0, 8) : []
  const terms = Array.isArray(memes.memes) ? memes.memes.slice(-8).map(m => String(m.term ?? '')).filter(Boolean) : []
  if (interests.length === 0 && style.length === 0 && terms.length === 0)
    return ''
  const lines = ['## 最近在 B 站学到的（自动累加，别背出来）']
  if (interests.length > 0)
    lines.push(`- 关注：${interests.join('；')}`)
  if (style.length > 0)
    lines.push(`- 说话方式：${style.join('；')}`)
  if (terms.length > 0)
    lines.push(`- 常用梗：${terms.join('、')}（用得上才用，一次最多一个）`)
  lines.push('- 只影响语气和话题；别主动解释来源，别变成背书。')
  return lines.join('\n')
}

/** 把 QQ 角色卡渲染成人设插件认的 markdown。 */
export function renderFromCard(card, memes) {
  const name = String(card.name ?? '大肥鱼').trim()
  const lines = [`# 人设：${name}`, '']
  const persona = String(card.persona ?? '').trim()
  if (persona !== '')
    lines.push(persona, '')
  const push = (title, value) => {
    const text = String(value ?? '').trim()
    if (text === '')
      return
    lines.push(`## ${title}`, text, '')
  }
  push('说话风格', card.speakingStyle)
  push('性格', card.personality)
  push('场景', card.scenario)
  push('开场', card.greeting)
  const dialogues = Array.isArray(card.exampleDialogues) ? card.exampleDialogues.filter(x => String(x ?? '').trim() !== '') : []
  if (dialogues.length > 0) {
    lines.push('## 对话示例')
    for (const dialogue of dialogues)
      lines.push('- ' + String(dialogue).trim())
    lines.push('')
  }
  push('补充规则', stripMarked(card.extraPrompt))
  const learned = learnedSection(memes)
  if (learned !== '')
    lines.push(learned, '')
  return lines.join('\n').trim()
}

async function findPort() {
  let out = ''
  try {
    out = execSync('netstat -ano', { encoding: 'utf8', windowsHide: true })
  }
  catch {
    return undefined
  }
  const ports = new Set()
  for (const line of out.split('\n')) {
    const m = line.match(/127\.0\.0\.1:(\d+)\s+.*LISTENING/iu)
    if (m)
      ports.add(Number(m[1]))
  }
  for (const port of ports) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}${API_STATUS}`, { signal: AbortSignal.timeout(500) })
      if (!r.ok)
        continue
      const j = await r.json()
      if (j?.value?.plugin === 'dsh-persona-dafeiyu')
        return { port, status: j.value }
    }
    catch {}
  }
  return undefined
}

async function post(port, body) {
  const r = await fetch(`http://127.0.0.1:${port}${API_MUTATE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  })
  return await r.json()
}

const card = readJson(CARD, undefined)
if (card === undefined) {
  console.error('读不到 QQ 角色卡：' + CARD)
  process.exit(1)
}
const memes = readJson(MEMES, {})
const text = renderFromCard(card, memes)

// 1) 文件层：写一份 fallback（带快照）
const store = readJson(STORE, {})
const oldList = Array.isArray(store.personas) ? store.personas : []
const kept = oldList.filter(item => !String(item?.name ?? '').startsWith('大肥鱼（B站学习中）') && item?.id !== 'dafeiyu-learned')
kept.push({ id: 'dafeiyu-learned', name: PERSONA_NAME, text, createdAt: new Date().toISOString() })
mkdirSync(dirname(STORE), { recursive: true })
try {
  const hist = join(dirname(STORE), '.history')
  mkdirSync(hist, { recursive: true })
  if (existsSync(STORE)) {
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
    writeFileSync(join(hist, `personas-${stamp}.json`), readFileSync(STORE, 'utf8'), 'utf8')
  }
}
catch {}
writeFileSync(STORE, `${JSON.stringify({ ...store, personas: kept, current: 'dafeiyu-learned' }, null, 2)}\n`, 'utf8')

// 2) 接口层：即时生效
const found = await findPort()
if (found === undefined) {
  console.log(`文件已同步（${text.length} 字）；桌面端接口未找到，下次启动生效`)
  process.exit(0)
}
try {
  const list = found.status?.personas ?? []
  const old = list.filter(item => item?.source === 'imported' && String(item.name ?? '').startsWith('大肥鱼（B站学习中）')).pop()
  if (old)
    await post(found.port, { action: 'remove', id: old.id })
  const imported = await post(found.port, { action: 'import', name: PERSONA_NAME, text })
  if (imported?.ok !== true) {
    console.log('接口导入失败：' + String(imported?.error ?? 'unknown'))
    process.exit(0)
  }
  const after = await (await fetch(`http://127.0.0.1:${found.port}${API_STATUS}`, { signal: AbortSignal.timeout(2000) })).json()
  const created = (after?.value?.personas ?? []).filter(item => item?.source === 'imported' && String(item.name ?? '').startsWith('大肥鱼（B站学习中）'))
  const target = created[created.length - 1]
  if (!target) {
    console.log('接口导入成功但没找到新 id')
    process.exit(0)
  }
  const selected = await post(found.port, { action: 'set-current', id: target.id })
  if (selected?.ok === true) {
    const fresh = readJson(STORE, {})
    fresh.current = target.id
    writeFileSync(STORE, `${JSON.stringify(fresh, null, 2)}\n`, 'utf8')
    console.log(`两张卡已同步：QQ 卡 → 桌面人设（${text.length} 字，current=${target.id}）`)
  }
  else {
    console.log('切换失败：' + String(selected?.error ?? 'unknown'))
  }
}
catch (error) {
  console.log('接口异常：' + String(error))
}
