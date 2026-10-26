/**
 * dsh-qq-social —— QQ 群里大肥鱼的「拟人化」设置（桌面端设置分栏）
 *
 * 数据落在 <QQ_HOME>\\social.json，由 QQ 桥实例启动时读取。
 * 保存后可选自动重启 QQ 桥，让开关立刻生效。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { connect } from 'node:net'

export const name = 'qq-social'

const CONFIG_PATH = '<QQ_HOME>\\social.json'
const ROUTE = '/dsh-qq-social-api'

const DEFAULTS = {
  affinityEnabled: true,
  slangEnabled: true,
  personaEvolutionEnabled: true,
  cardEvolutionEnabled: true,
  triggerWindowMinutes: 5,
  evolutionRefreshEvery: 60,
  personaNote: '',
  moodEnabled: true,
  moodDurationHours: 4,
  guardMuteCheck: true,
  guardMaxRepliesPerMinute: 4,
  visionEnabled: true,
  visionModel: 'vision-api',
  visionMaxImages: 3,
  webEnabled: true,
  webVisible: true,
  webMaxSteps: 12,
  webTimeoutMinutes: 4,
}

function normalize(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  // 兼容嵌套写法（social.json 里 mood/guard 是分开的块）
  const mood = source.mood !== null && typeof source.mood === 'object' ? source.mood : {}
  const guard = source.guard !== null && typeof source.guard === 'object' ? source.guard : {}
  const vision = source.vision !== null && typeof source.vision === 'object' ? source.vision : {}
  const web = source.web !== null && typeof source.web === 'object' ? source.web : {}
  const pickBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
  const bool = (value, fallback) => pickBool(value, fallback)
  const num = (value, min, max, fallback) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed))
      return fallback
    return Math.min(max, Math.max(min, Math.round(parsed)))
  }
  return {
    affinityEnabled: bool(source.affinityEnabled, DEFAULTS.affinityEnabled),
    slangEnabled: bool(source.slangEnabled, DEFAULTS.slangEnabled),
    personaEvolutionEnabled: bool(source.personaEvolutionEnabled, DEFAULTS.personaEvolutionEnabled),
    cardEvolutionEnabled: bool(source.cardEvolutionEnabled, DEFAULTS.cardEvolutionEnabled),
    triggerWindowMinutes: num(source.triggerWindowMinutes, 0, 120, DEFAULTS.triggerWindowMinutes),
    evolutionRefreshEvery: num(source.evolutionRefreshEvery, 20, 2000, DEFAULTS.evolutionRefreshEvery),
    personaNote: String(source.personaNote ?? '').slice(0, 4000),
    moodEnabled: pickBool(mood.enabled, pickBool(source.moodEnabled, DEFAULTS.moodEnabled)),
    moodDurationHours: num(mood.durationHours ?? source.moodDurationHours, 1, 72, DEFAULTS.moodDurationHours),
    guardMuteCheck: pickBool(guard.muteCheck, pickBool(source.guardMuteCheck, DEFAULTS.guardMuteCheck)),
    guardMaxRepliesPerMinute: num(guard.maxRepliesPerMinute ?? source.guardMaxRepliesPerMinute, 0, 60, DEFAULTS.guardMaxRepliesPerMinute),
    visionEnabled: pickBool(vision.enabled, pickBool(source.visionEnabled, DEFAULTS.visionEnabled)),
    visionModel: String(vision.model ?? source.visionModel ?? DEFAULTS.visionModel).slice(0, 80),
    visionMaxImages: num(vision.maxImages ?? source.visionMaxImages, 1, 10, DEFAULTS.visionMaxImages),
    webEnabled: pickBool(web.enabled, pickBool(source.webEnabled, DEFAULTS.webEnabled)),
    webVisible: pickBool(web.visible, pickBool(source.webVisible, DEFAULTS.webVisible)),
    webMaxSteps: num(web.maxSteps ?? source.webMaxSteps, 1, 30, DEFAULTS.webMaxSteps),
    webTimeoutMinutes: num(web.timeoutMinutes ?? source.webTimeoutMinutes, 1, 15, DEFAULTS.webTimeoutMinutes),
  }
}

function readConfig() {
  try {
    if (existsSync(CONFIG_PATH))
      return normalize(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')))
  }
  catch {
    // 文件坏了就按默认值走
  }
  return { ...DEFAULTS }
}

function writeConfig(next) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true })
  // social.json 是「扁平 social 字段 + 两个嵌套块」的混合结构，qq-groupmate 两个都认
  const { moodEnabled, moodDurationHours, guardMuteCheck, guardMaxRepliesPerMinute, visionEnabled, visionModel, visionMaxImages, webEnabled, webVisible, webMaxSteps, webTimeoutMinutes, ...flat } = next
  const payload = {
    ...flat,
    mood: { enabled: moodEnabled !== false, durationHours: moodDurationHours ?? 4 },
    guard: {
      muteCheck: guardMuteCheck !== false,
      muteCacheSeconds: 20,
      maxRepliesPerMinute: guardMaxRepliesPerMinute ?? 4,
    },
    vision: {
      enabled: visionEnabled !== false,
      model: visionModel ?? 'vision-api',
      maxImages: visionMaxImages ?? 3,
    },
    web: {
      enabled: webEnabled !== false,
      visible: webVisible !== false,
      maxSteps: webMaxSteps ?? 12,
      timeoutMinutes: webTimeoutMinutes ?? 4,
    },
  }
  writeFileSync(CONFIG_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function restartBridge() {
  execFile('cmd.exe', ['/c', '<QQ_HOME>\\stop-qq.cmd'], { windowsHide: true }, () => {
    execFile('wscript.exe', ['<QQ_HOME>\\start-qq-hidden.vbs'], { windowsHide: true }, () => {})
  })
}

function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** 端口是否有人监听（用来判断 QQ 桥 / NapCat 有没有起来）。 */
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    let settled = false
    const done = (value) => {
      if (settled)
        return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(800, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

const BRIDGE_START = '<QQ_HOME>\\start-qq-hidden.vbs'
const NAPCAT_START = '<QQ_HOME>\\start-napcat.cmd'
const AFFINITY_PATH = '<QQ_HOME>\\home\\qq-groupmate\\affinity.json'
const MEMES_PATH = '<QQ_HOME>\\home\\qq-groupmate\\bili-memes.json'
const GROWTH_PATH = '<QQ_HOME>\\home\\qq-groupmate\\card-growth.json'
const AYU_LEARN = { python: '<PYTHON_EXE>', script: '<QQ_HOME>\\ayu-learn.py' }

/** 读「人格卡学习记录」（每次学习的版本快照摘要）。 */
function readGrowth() {
  try {
    if (!existsSync(GROWTH_PATH))
      return { versions: [] }
    const data = JSON.parse(readFileSync(GROWTH_PATH, 'utf8'))
    const versions = Array.isArray(data.versions) ? data.versions.slice(-30).reverse() : []
    return { versions }
  }
  catch {
    return { versions: [] }
  }
}

/** 读梗库（B站学到的梗/风格/兴趣）。 */
function readMemes() {
  const empty = { memes: [], interests: [], style: [], updatedAt: '' }
  try {
    if (!existsSync(MEMES_PATH))
      return empty
    const data = JSON.parse(readFileSync(MEMES_PATH, 'utf8'))
    return {
      memes: Array.isArray(data.memes) ? data.memes : [],
      interests: Array.isArray(data.interests) ? data.interests : [],
      style: Array.isArray(data.style) ? data.style : [],
      updatedAt: String(data.updatedAt ?? ''),
    }
  }
  catch {
    return empty
  }
}

function writeMemes(data) {
  mkdirSync(dirname(MEMES_PATH), { recursive: true })
  writeFileSync(MEMES_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}
const BILI_CONFIG = '<DSH_HOME>\\bili-duty\\config.json'

/** 读「刷B站」的简化配置（只给快捷模式用）。 */
function readBiliConfig() {
  const empty = { mode: 'report', perDay: 5, noon: false, night: false, mentionName: '', available: false }
  try {
    if (!existsSync(BILI_CONFIG))
      return empty
    const data = JSON.parse(readFileSync(BILI_CONFIG, 'utf8'))
    const mode = data.autoComment === true && data.replyToComments === true
      ? 'full'
      : (data.autoComment === true ? 'comments' : 'report')
    return {
      mode,
      perDay: Number(data.perDay ?? 5),
      noon: data.noon === true,
      night: data.night === true,
      mentionName: String(data.mentionName ?? ''),
      available: true,
    }
  }
  catch {
    return empty
  }
}

/** 把快捷模式写回插件自己的 config.json（只改这几个键，其它保持原样）。 */
function writeBiliConfig(input) {
  const src = input !== null && typeof input === 'object' ? input : {}
  const data = existsSync(BILI_CONFIG) ? JSON.parse(readFileSync(BILI_CONFIG, 'utf8')) : {}
  const mode = ['report', 'comments', 'full'].includes(src.mode) ? src.mode : 'report'
  data.autoComment = mode === 'comments' || mode === 'full'
  data.replyToComments = mode === 'full'
  if (typeof src.noon === 'boolean')
    data.noon = src.noon
  if (typeof src.night === 'boolean')
    data.night = src.night
  const perDay = Number(src.perDay)
  if (Number.isFinite(perDay))
    data.perDay = Math.min(50, Math.max(1, Math.round(perDay)))
  data.peakValley = data.noon === true || data.night === true
  if (typeof src.mentionName === 'string')
    data.mentionName = src.mentionName.slice(0, 40)
  mkdirSync(dirname(BILI_CONFIG), { recursive: true })
  writeFileSync(BILI_CONFIG, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  return readBiliConfig()
}

function tierOf(score) {
  if (score >= 25)
    return '自己人'
  if (score >= 10)
    return '熟人'
  if (score >= 3)
    return '眼熟'
  if (score < 0)
    return '不爽'
  return '陌生'
}

/** 读出好感度表：以 QQ 号为键的全局档案 + 分群/私聊明细。 */
function readAffinity() {
  const empty = { people: [], groups: [] }
  try {
    if (!existsSync(AFFINITY_PATH))
      return empty
    const data = JSON.parse(readFileSync(AFFINITY_PATH, 'utf8'))
    const people = Object.values(data.people ?? {}).map((person) => {
      const chats = Object.entries(person.chats ?? {})
      return {
        qq: String(person.qq ?? ''),
        name: String(person.name ?? '') || String(chats.find(([, chat]) => chat.name)?.[1]?.name ?? ''),
        score: Number(person.score ?? 0),
        tier: tierOf(Number(person.score ?? 0)),
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
    return { people, groups }
  }
  catch {
    return empty
  }
}

/**
 * 开 DSH 就把 QQ 那套拉起来：
 * - 3081 没监听 → 启动独立 DSH 实例（QQ 桥）
 * - 6099 没监听 → 启动 NapCat（QQ 协议端）
 * 两个启动脚本都是幂等的，重复调用不会起第二个实例。
 */
async function ensureStarted(logger) {
  try {
    if (!await portOpen(3081)) {
      logger?.info?.('qq-social: 检测到 QQ 桥未运行，正在启动')
      execFile('wscript.exe', [BRIDGE_START], { windowsHide: true }, () => {})
    }
    if (!await portOpen(6099)) {
      logger?.info?.('qq-social: 检测到 NapCat 未运行，正在启动')
      execFile('cmd.exe', ['/c', NAPCAT_START], { windowsHide: true }, () => {})
    }
  }
  catch {
    // 启动失败不影响 DSH 本身
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 64 * 1024)
        req.destroy()
    })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

export function apply(ctx) {
  const logger = ctx.logger ?? ctx.get?.('logger')
  // [local patch 2026-10-23] DSH 启动即拉起 QQ 桥与 NapCat，并每 60 秒兜底
  void ensureStarted(logger)
  const timer = setInterval(() => { void ensureStarted(logger) }, 60_000)
  timer.unref?.()
  ctx.effect(() => () => clearInterval(timer))

  const webServer = ctx.webServer ?? ctx.get('webServer')
  if (webServer === undefined)
    return
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: ROUTE,
    async handler(req, res) {
      if (!isLoopback(req)) {
        json(res, 403, { ok: false, error: 'loopback only' })
        return
      }
      try {
        if (req.method === 'GET') {
          const url = String(req.url ?? '')
          if (url.includes('view=affinity')) {
            const data = readAffinity()
            json(res, 200, { ok: true, ...data, path: AFFINITY_PATH })
            return
          }
          if (url.includes('view=bili')) {
            json(res, 200, { ok: true, bili: readBiliConfig(), path: BILI_CONFIG })
            return
          }
          if (url.includes('view=memes')) {
            json(res, 200, { ok: true, ...readMemes(), path: MEMES_PATH })
            return
          }
          if (url.includes('view=growth')) {
            json(res, 200, { ok: true, ...readGrowth(), path: GROWTH_PATH })
            return
          }
          json(res, 200, { ok: true, config: readConfig(), path: CONFIG_PATH })
          return
        }
        if (req.method === 'POST') {
          const raw = await readBody(req)
          const body = raw === '' ? {} : JSON.parse(raw)
          if (body.bili !== undefined) {
            const saved = writeBiliConfig(body.bili)
            json(res, 200, { ok: true, bili: saved })
            return
          }
          if (body.memes !== undefined) {
            const action = String(body.memes.action ?? '')
            if (action === 'delete') {
              const term = String(body.memes.term ?? '').trim()
              const data = readMemes()
              const list = data.memes.filter(item => String(item.term ?? '') !== term)
              writeMemes({ ...data, memes: list, updatedAt: new Date().toISOString().slice(0, 19) })
              json(res, 200, { ok: true, deleted: term, ...readMemes() })
              return
            }
            if (action === 'relearn') {
              execFile(AYU_LEARN.python, [AYU_LEARN.script], { windowsHide: true, detached: true }, () => {})
              json(res, 200, { ok: true, started: true })
              return
            }
            json(res, 400, { ok: false, error: 'unknown memes action' })
            return
          }
          const next = normalize(body.config ?? body)
          writeConfig(next)
          if (body.restart !== false)
            restartBridge()
          json(res, 200, { ok: true, config: next, restarted: body.restart !== false })
          return
        }
        json(res, 405, { ok: false, error: 'method not allowed' })
      }
      catch (error) {
        json(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
      }
    },
  }))
}

export const inject = ['webServer']
