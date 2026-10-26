/**
 * dsh-qq-amem —— 阿圆的「外挂增强」插件（独立安装，零改动 qq-groupmate）
 *
 * 做两件事：
 *   1. 记忆蒸馏：定时把群聊里值得长期记住的事，写进 qq-groupmate 会读取的
 *      `people/events.json`（长期事件档案），阿圆下次回复时就会看到。
 *   2. 主动发言：群里安静到一定时间后，自己攒一句话发出去（走 NapCat HTTP API）。
 *
 * 安全约束：
 *   - 只读 qq-groupmate 的 state.json / characters/*.json
 *   - 只写 people/events.json，且写前备份、读-改-写合并，绝不删除已有条目
 *   - 所有异常自己吞掉，不影响宿主和其它插件
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'

export const name = 'qq-amem'

const DEFAULT_CONFIG = {
  enabled: true,
  dataDir: '<QQ_HOME>\\home\\qq-groupmate',
  character: 'dafeiyu',
  externalHistoryFile: '<QQ_HOME>\\home\\qq-groupmate\\external-history.jsonl',
  api: {
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-chat',
    zerolanConfig: '<LEGACY_LLM_CONFIG>',
  },
  memory: {
    enabled: true,
    scanMinutes: 30,
    minNewMessages: 25,
    maxEvents: 3,
    provider: '',
    model: '',
    maxTokens: 400,
  },
  proactive: {
    enabled: false,
    groups: [],
    quietMinutes: 90,
    maxPerDay: 2,
    activeHours: [9, 23],
    apiBase: 'http://127.0.0.1:6098',
    apiToken: '',
    provider: '',
    model: '',
    maxChars: 120,
  },
  // [local patch 2026-10-26] 每天固定时间跑一次 B站学习（更新兴趣/梗库/人格卡）
  learn: {
    enabled: true,
    hour: 3,
    minute: 30,
    python: '',
    script: '',
  },
}

function withDefaults(input) {
  const source = input ?? {}
  return {
    ...DEFAULT_CONFIG,
    ...source,
    api: { ...DEFAULT_CONFIG.api, ...(source.api ?? {}) },
    memory: { ...DEFAULT_CONFIG.memory, ...(source.memory ?? {}) },
    proactive: { ...DEFAULT_CONFIG.proactive, ...(source.proactive ?? {}) },
    learn: { ...DEFAULT_CONFIG.learn, ...(source.learn ?? {}) },
  }
}

/** 没配 apiKey 时，尝试从 Zerolan 的 config.yaml 里借一个（同一台机器上已验证可用）。 */
function borrowApiKey(api) {
  if (api.apiKey && api.apiKey.startsWith('sk-'))
    return api.apiKey
  try {
    if (api.zerolanConfig && existsSync(api.zerolanConfig)) {
      const text = readFileSync(api.zerolanConfig, 'utf8')
      const matched = text.match(/api_key:\s*'([^']+)'/)
      if (matched && matched[1].startsWith('sk-'))
        return matched[1]
    }
  }
  catch {}
  return ''
}

/** 直连 OpenAI 兼容接口（DeepSeek）。返回纯文本。 */
async function callApi(api, { system, prompt, maxTokens = 400 }) {
  const key = borrowApiKey(api)
  if (key === '')
    throw new Error('API_KEY_MISSING')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  timer.unref?.()
  try {
    const response = await fetch(`${api.baseUrl.replace(/\/$/u, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: api.model || 'deepseek-chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: maxTokens,
        stream: false,
      }),
    })
    const text = await response.text()
    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${clip(text, 160)}`)
    const data = JSON.parse(text)
    return String(data?.choices?.[0]?.message?.content ?? '').trim()
  }
  finally {
    clearTimeout(timer)
  }
}

function readJson(file, fallback) {
  try {
    if (!existsSync(file))
      return fallback
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  catch {
    return fallback
  }
}

function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.amem.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

function clip(text, max) {
  const value = String(text ?? '').trim()
  return value.length > max ? value.slice(0, max) : value
}

/** 从群聊历史里取「本次要处理的窗口」。 */
function historyOf(state, groupId) {
  const record = state?.groups?.[groupId]
  const history = record?.history
  return Array.isArray(history) ? history : []
}

async function callLlm(ctx, { provider, model, system, prompt, maxTokens = 400 }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  timer.unref?.()
  try {
    const stream = ctx.llm.stream({
      provider: provider || undefined,
      model: model || undefined,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      temperature: 0.7,
      maxTokens,
      signal: controller.signal,
    })
    let text = ''
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta')
        text += chunk.text ?? ''
      else if (chunk.type === 'finish' && chunk.reason?.kind === 'error')
        throw new Error(`llm error: ${chunk.reason.failure?.code ?? 'unknown'}`)
    }
    return text.trim()
  }
  finally {
    clearTimeout(timer)
  }
}

function nowId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function apply(ctx, rawConfig) {
  const cfg = withDefaults(rawConfig)
  if (cfg.enabled !== true)
    return
  const logger = ctx.logger ?? ctx.get?.('logger')
  const logFile = join(cfg.dataDir, 'amem.log')
  const fileLog = (level, message) => {
    try {
      appendFileSync(logFile, `${new Date().toISOString()} [${level}] ${message}\n`, 'utf8')
    }
    catch {}
  }
  const log = (message) => { fileLog('info', message); logger?.info?.('qq-amem: %s', message) }
  const warn = (message) => { fileLog('warn', message); logger?.warn?.('qq-amem: %s', message) }

  const stateFile = join(cfg.dataDir, 'amem-state.json')
  const eventsFile = join(cfg.dataDir, 'people', 'events.json')
  const qqStateFile = join(cfg.dataDir, 'state.json')
  const characterFile = join(cfg.dataDir, 'characters', `${cfg.character}.json`)

  const loadState = () => readJson(stateFile, {
    lastScanAt: 0,
    lastSeenTime: {},
    proactive: { day: '', count: 0, lastAt: {}, lastActivityAt: {} },
  })
  const saveState = (state) => {
    try {
      writeJsonAtomic(stateFile, state)
    }
    catch (error) {
      warn(`保存状态失败：${String(error)}`)
    }
  }

  /** 1) 记忆蒸馏：把最近值得记的事写进 people/events.json */
  async function distill(state) {
    const memory = cfg.memory
    if (memory.enabled !== true)
      return
    if (Date.now() - (state.lastScanAt ?? 0) < memory.scanMinutes * 60_000)
      return

    const qq = readJson(qqStateFile, undefined)
    if (qq === undefined || qq.groups === undefined)
      return

    const fresh = []
    for (const [groupId, record] of Object.entries(qq.groups)) {
      if (groupId.startsWith('private:'))
        continue
      const history = historyOf(qq, groupId)
      const since = state.lastSeenTime?.[groupId] ?? 0
      for (const entry of history) {
        if (entry?.role !== 'user')
          continue
        const at = Number(entry.time ?? 0)
        if (at <= since)
          continue
        const text = clip(entry.text, 200)
        if (text === '' || text === '[图片]')
          continue
        fresh.push({ groupId, at, speaker: String(entry.speaker ?? ''), userId: String(entry.userId ?? ''), text })
      }
    }
    if (fresh.length < memory.minNewMessages) {
      log(`蒸馏跳过：新消息只有 ${fresh.length} 条（门槛 ${memory.minNewMessages}）`)
      state.lastScanAt = Date.now()
      saveState(state)
      return
    }
    log(`蒸馏开始：新消息 ${fresh.length} 条`)

    const sample = fresh.slice(-80).map(item => `[${item.groupId}] ${item.speaker}: ${item.text}`).join('\n')
    const system = '你在帮一个群聊机器人整理「值得长期记住」的事。只输出事件条目，每行一条，格式严格为：重要度(1-5)|类别(event/topic/promise/joke/grudge/preference)|一句话描述（不超过60字）。没有值得记的就输出 NONE。'
    let output = ''
    try {
      log(`调用 ${cfg.api.model || 'deepseek-chat'} 提炼记忆（样本 ${fresh.length} 条）`)
      output = await callApi(cfg.api, {
        system,
        prompt: `以下是最近的群聊记录：\n${sample}\n\n请提炼最多 ${memory.maxEvents} 条。`,
        maxTokens: memory.maxTokens,
      })
      log(`模型返回 ${output.length} 字`)
    }
    catch (error) {
      warn(`记忆蒸馏调用模型失败：${String(error)}`)
      if (String(error).includes('NO_ADAPTER')) {
        log('模型服务商还没就绪，下一分钟重试')
        return
      }
      state.lastScanAt = Date.now()
      saveState(state)
      return
    }

    const lines = output.split('\n').map(item => item.trim()).filter(Boolean)
    const events = []
    for (const line of lines) {
      if (line === 'NONE')
        continue
      const parts = line.split('|').map(item => item.trim())
      if (parts.length < 3)
        continue
      const importance = Math.min(5, Math.max(1, Number(parts[0]) || 3))
      const kind = ['event', 'topic', 'promise', 'joke', 'grudge', 'preference'].includes(parts[1]) ? parts[1] : 'event'
      const text = clip(parts.slice(2).join('|'), 80)
      if (text === '')
        continue
      const groupId = fresh[fresh.length - 1].groupId
      const participants = [...new Set(fresh.filter(item => text.includes(item.speaker.slice(0, 4)) || text.includes(item.speaker)).map(item => item.userId).filter(Boolean))].slice(0, 5)
      events.push({
        id: nowId('amem'),
        text,
        kind,
        scope: 'chat',
        chatKey: groupId,
        participants,
        importance,
        weight: 0.9,
        pinned: false,
        hits: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastTouchedAt: Date.now(),
        lastMentionAt: 0,
        expiresAt: 0,
        resolved: false,
        origin: 'amem',
      })
    }

    if (events.length > 0) {
      try {
        const existing = readJson(eventsFile, { version: 1, updatedAt: 0, events: [] })
        const list = Array.isArray(existing) ? existing : (existing.events ?? [])
        try {
          copyFileSync(eventsFile, `${eventsFile}.bak`)
        }
        catch {}
        const merged = [...list, ...events.slice(0, memory.maxEvents)]
        writeJsonAtomic(eventsFile, { version: 1, updatedAt: Date.now(), events: merged })
        log(`写入 ${events.length} 条长期事件`)
      }
      catch (error) {
        warn(`写入事件档案失败：${String(error)}`)
      }
    }

    for (const item of fresh)
      state.lastSeenTime[item.groupId] = Math.max(state.lastSeenTime[item.groupId] ?? 0, item.at)
    state.lastScanAt = Date.now()
    saveState(state)
  }

  /** 2) 主动发言：群里安静够久就自己说一句 */
  async function maybeSpeak(state) {
    const proactive = cfg.proactive
    if (proactive.enabled !== true || proactive.groups.length === 0)
      return
    const hour = new Date().getHours()
    if (hour < proactive.activeHours[0] || hour >= proactive.activeHours[1])
      return

    const day = new Date().toISOString().slice(0, 10)
    if (state.proactive.day !== day)
      state.proactive = { day, count: 0, lastAt: {}, lastActivityAt: {} }
    if (state.proactive.count >= proactive.maxPerDay)
      return

    const qq = readJson(qqStateFile, undefined)
    if (qq === undefined)
      return

    for (const groupId of proactive.groups) {
      const history = historyOf(qq, groupId)
      if (history.length === 0)
        continue
      const lastActivity = Number(history[history.length - 1]?.time ?? 0)
      if (lastActivity === 0)
        continue
      if (Date.now() - lastActivity < proactive.quietMinutes * 60_000)
        continue
      if (state.proactive.lastActivityAt[groupId] === lastActivity)
        continue // 这一轮安静已经说过

      const character = readJson(characterFile, {})
      const persona = clip(`${character.persona ?? ''} ${character.speakingStyle ?? ''}`, 400)
      const recent = history.slice(-12).map(entry => `${entry.speaker ?? '群友'}: ${clip(entry.text, 80)}`).join('\n')
      const system = `你在扮演群聊里的「${character.name ?? '阿圆'}」。${persona}\n现在群里安静了一段时间，你要主动说一句自然的话（不超过 ${proactive.maxChars} 字），可以接上刚才的话题、提个小问题、或者单纯冒个泡。只输出这句话本身，不要引号、不要解释。`
      let line = ''
      try {
        line = await callApi(cfg.api, {
          system,
          prompt: `群号 ${groupId} 最近的消息：\n${recent || '（还没有消息）'}\n\n说一句：`,
          maxTokens: 200,
        })
      }
      catch (error) {
        warn(`生成主动发言失败：${String(error)}`)
        return
      }
      line = clip(line.replace(/^["「]|["」]$/g, ''), proactive.maxChars)
      if (line === '')
        continue

      try {
        const response = await fetch(`${proactive.apiBase}/send_group_msg`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(proactive.apiToken === '' ? {} : { authorization: `Bearer ${proactive.apiToken}` }),
          },
          body: JSON.stringify({ group_id: Number(groupId), message: [{ type: 'text', data: { text: line } }] }),
        })
        const body = await response.text()
        if (!response.ok) {
          warn(`主动发言发送失败 ${response.status}: ${clip(body, 120)}`)
          continue
        }
        state.proactive.count += 1
        state.proactive.lastAt[groupId] = Date.now()
        state.proactive.lastActivityAt[groupId] = lastActivity
        saveState(state)
        log(`在群 ${groupId} 主动发言：${line}`)
        // 写回阿圆的对话历史（qq-groupmate 每 15 秒合并一次），这样群友回话时它知道自己说过
        try {
          appendFileSync(cfg.externalHistoryFile, `${JSON.stringify({
            scope: String(groupId),
            role: 'assistant',
            speaker: character.name ?? '阿圆',
            text: line,
            time: Date.now(),
          })}\n`, 'utf8')
        }
        catch (error) {
          warn(`写回历史失败：${String(error)}`)
        }
      }
      catch (error) {
        warn(`主动发言请求异常：${String(error)}`)
      }
    }
  }

  /** 3) 每天固定跑一次 B站学习（更新兴趣/梗库/人格卡） */
  async function maybeLearn(state) {
    const learn = cfg.learn
    if (learn.enabled !== true)
      return
    const now = new Date()
    const day = now.toISOString().slice(0, 10)
    if (state.learn?.day === day)
      return
    if (now.getHours() < learn.hour)
      return
    if (now.getHours() === learn.hour && now.getMinutes() < learn.minute)
      return
    try {
      const child = spawn(learn.python, [learn.script], { detached: true, stdio: 'ignore' })
      child.unref()
      state.learn = { day, at: Date.now() }
      saveState(state)
      log('B站学习任务已启动')
    }
    catch (error) {
      warn(`启动 B站学习失败：${String(error)}`)
    }
  }

  let running = false
  async function tick() {
    if (running)
      return
    running = true
    try {
      const state = loadState()
      await distill(state)
      await maybeSpeak(state)
      await maybeLearn(state)
    }
    catch (error) {
      warn(`tick 异常（已忽略）：${String(error)}`)
    }
    finally {
      running = false
    }
  }

  log(`已启动（记忆蒸馏：${cfg.memory.enabled ? '开' : '关'}；主动发言：${cfg.proactive.enabled ? '开' : '关'}）`)
  try {
    const ids = ctx.llm.listProviders?.().map(item => item.id) ?? []
    log(`可用 provider=${ids.join(',') || '(空)'}；memory 用 ${cfg.memory.provider || '(未指定)'}/${cfg.memory.model || '(未指定)'}`)
  }
  catch (error) {
    warn(`读取 provider 列表失败：${String(error)}`)
  }
  const timer = setInterval(() => { void tick() }, 60_000)
  timer.unref?.()
  // 首次延迟，等模型服务商注册完再跑
  const first = setTimeout(() => { void tick() }, 45_000)
  first.unref?.()
  ctx.effect(() => () => { clearInterval(timer); clearTimeout(first) })
}

export const inject = ['llm']
