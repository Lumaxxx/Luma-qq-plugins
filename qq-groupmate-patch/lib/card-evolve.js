/**
 * 角色卡演化（本地补丁，2026-10-22）
 *
 * 用户要求「自主学习可以更改角色卡」，但直接改整张卡风险很大（可能改掉身份/底线）。
 * 这里的策略：
 *   - 只改两个字段：speakingStyle（说话风格）、personality（性格）
 *   - 永不触碰：name / aliases / persona / scenario / greeting / exampleDialogues / extraPrompt
 *   - 每次写入前先把原卡备份到 characters/.history/，保留最近 5 份
 *   - 只追加一次同样的句子（幂等），不会越堆越长
 *
 * 回滚：把 .history 里任意一份拷回 <角色>.json 即可。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_HISTORY = 5
const MAX_FIELD_CHARS = 900

function trimText(value, max) {
  const text = String(value ?? '').trim()
  return text.length > max ? text.slice(0, max) : text
}

/** 从学到的画像里抽几个「口头禅」，拼成一句简短的风格补充。 */
function styleSnippet(learnedStyle) {
  const text = String(learnedStyle ?? '')
  if (text === '')
    return ''
  const quotes = []
  for (const match of text.matchAll(/「([^」]{1,8})」/gu)) {
    const word = match[1].trim()
    if (word !== '' && !quotes.includes(word))
      quotes.push(word)
    if (quotes.length >= 3)
      break
  }
  return quotes.length === 0 ? '' : `最近学到的口头禅：${quotes.map(word => `「${word}」`).join('')}。`
}

/** 从关系数据里拼一句态度倾向（带 QQ 号，换群/私聊也认得出是谁）。 */
function attitudeSnippet(relations) {
  const list = Array.isArray(relations) ? relations : []
  const label = item => {
    const name = String(item.name ?? '').trim()
    const qq = String(item.qq ?? item.userId ?? '').trim()
    if (name === '' && qq === '')
      return ''
    if (name === '')
      return `QQ ${qq}`
    return qq === '' ? name : `${name}（QQ ${qq}）`
  }
  const close = list.filter(item => (item.score ?? 0) >= 10).slice(0, 2).map(label).filter(Boolean)
  const cold = list.filter(item => (item.score ?? 0) < 0).slice(0, 2).map(label).filter(Boolean)
  const parts = []
  if (close.length > 0)
    parts.push(`跟 ${close.join('、')} 已经很熟，会主动接话`)
  if (cold.length > 0)
    parts.push(`对 ${cold.join('、')} 比较冷淡`)
  return parts.length === 0 ? '' : `${parts.join('；')}。`
}

export class CardEvolver {
  constructor({ dir, logger }) {
    this.dir = dir
    this.logger = logger
  }

  pathOf(characterId) {
    const id = String(characterId ?? '').trim()
    return id === '' ? '' : join(this.dir, `${id}.json`)
  }

  /** 备份当前卡到 .history，只保留最近 5 份。 */
  backup(cardPath) {
    try {
      const historyDir = join(this.dir, '.history')
      mkdirSync(historyDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
      copyFileSync(cardPath, join(historyDir, `${stamp}.json`))
      const files = readdirSync(historyDir).filter(name => name.endsWith('.json')).sort()
      while (files.length > MAX_HISTORY)
        rmSync(join(historyDir, files.shift()), { force: true })
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 角色卡备份失败：%s', String(error))
    }
  }

  /**
   * 把学到的风格与关系倾向写进角色卡的 speakingStyle / personality。
   * @returns {{changed:boolean, fields:string[]}|null} 没有可写内容返回 null
   */
  evolve({ characterId, learnedStyle, relations }) {
    const cardPath = this.pathOf(characterId)
    if (cardPath === '' || !existsSync(cardPath))
      return null
    let card
    try {
      card = JSON.parse(readFileSync(cardPath, 'utf8'))
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 角色卡解析失败，跳过演化：%s', String(error))
      return null
    }
    const next = { ...card }
    const changed = []

    const style = styleSnippet(learnedStyle)
    if (style !== '') {
      const current = String(card.speakingStyle ?? '')
      if (!current.includes(style)) {
        next.speakingStyle = trimText(current === '' ? style : `${current} ${style}`, MAX_FIELD_CHARS)
        changed.push('speakingStyle')
      }
    }

    const attitude = attitudeSnippet(relations)
    if (attitude !== '') {
      const current = String(card.personality ?? '')
      if (!current.includes(attitude)) {
        next.personality = trimText(current === '' ? attitude : `${current} ${attitude}`, MAX_FIELD_CHARS)
        changed.push('personality')
      }
    }

    if (changed.length === 0)
      return null
    this.backup(cardPath)
    try {
      writeFileSync(cardPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 角色卡写回失败：%s', String(error))
      return null
    }
    this.logger?.info?.('qq-groupmate: 已把学习结果写回角色卡（%s）：%s', String(characterId), changed.join('、'))
    return { changed: true, fields: changed }
  }
}
