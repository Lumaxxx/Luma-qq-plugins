/**
 * [local patch 2026-10-27] 本地 OCR 前置：图里的字先用本地引擎读出来。
 *
 * 用 Umi-OCR（https://github.com/hiroi-sora/Umi-OCR）的 HTTP 接口：
 *   开启方式：Umi-OCR → 全局设置 → HTTP 服务 → 启用，默认 http://127.0.0.1:1224
 *   接口：POST /api/ocr  { "base64": "..." }
 *
 * 没装/没开就静默跳过（返回 undefined），不影响识图主流程。
 */
const DEFAULT_BASE = 'http://127.0.0.1:1224'
const PROBE_TTL_MS = 10 * 60 * 1000

let probedAt = 0
let available = false

export function ocrAvailable() {
  return available
}

async function probe(baseUrl, timeoutMs) {
  if (Date.now() - probedAt < PROBE_TTL_MS)
    return available
  probedAt = Date.now()
  available = false
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(`${baseUrl}/api/ocr/get_options`, { signal: controller.signal })
    clearTimeout(timer)
    available = response.ok
  }
  catch {
    available = false
  }
  return available
}

function textsFrom(payload) {
  if (payload === null || typeof payload !== 'object')
    return ''
  const data = payload.data
  if (Array.isArray(data))
    return data.map(item => String(item?.text ?? '')).filter(Boolean).join(' ')
  if (typeof data === 'string')
    return data
  if (Array.isArray(payload.result))
    return payload.result.map(item => String(item?.text ?? '')).filter(Boolean).join(' ')
  return ''
}

/**
 * @param {Buffer} buffer 图片原始字节
 * @returns {Promise<string|undefined>} 识别出的文字；没有引擎/没文字就 undefined
 */
export async function ocrImage(buffer, { baseUrl = DEFAULT_BASE, timeoutMs = 4000, logger } = {}) {
  if (buffer === undefined || buffer === null)
    return undefined
  if (!await probe(baseUrl, 1200))
    return undefined
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(`${baseUrl}/api/ocr`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base64: buffer.toString('base64') }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!response.ok)
      return undefined
    const payload = await response.json()
    const text = textsFrom(payload).replace(/\s+/g, ' ').trim()
    if (text === '')
      return undefined
    logger?.info?.('qq-groupmate: OCR 读到 %s 字', String(text.length))
    return text.slice(0, 800)
  }
  catch {
    return undefined
  }
}
