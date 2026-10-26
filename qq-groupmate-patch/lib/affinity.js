/**
 * 好感度 / 关系系统（本地补丁，2026-10-22）
 *
 * 目的：让机器人对不同人有「熟悉度」，并把这份熟悉度带进提示词，影响语气。
 * 设计原则：
 * - 纯本地、可解释：分数只由「说了什么」决定，不做人格评分或道德评判
 * - 有上限、会衰减：避免刷屏把分数刷到天上
 * - 只影响语气：不改变角色底线的任何一条
 *
 * 文件：<数据目录>/affinity.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 夸人的词：命中 +2。 */
const PRAISE = ['谢谢', '多谢', '厉害', '好棒', '可爱', '喜欢', '抱抱', '摸摸', '辛苦', '乖', '爱你', '牛', '赞', '靠谱']
/** 怼人的词：命中 -3。 */
const INSULT = ['滚', '傻', '笨', '烦', '闭嘴', '垃圾', '废物', '讨厌', '蠢', '丑', '别说话', '没用']

const MIN_SCORE = -50
const MAX_SCORE = 100
/** 一天不上线，分数往 0 靠一点（最多 3 分），避免老账永久生效。 */
const DECAY_PER_DAY = 1
const DECAY_CAP = 3

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/** 档位：只影响语气，不做歧视。 */
export function tierOf(score) {
  if (score >= 25)
    return '自己人'
  if (score >= 10)
    return '熟人'
  if (score >= 3)
    return '眼熟'
  return '陌生'
}

export class AffinityStore {
  /** @type {Record<string, Record<string, {score:number, msgs:number, lastAt:number, name:string, reason:string}>>} */
  groups = {}
  /** @type {Record<string, {qq:string, name:string, score:number, msgs:number, lastAt:number, chats:Record<string, {name:string, lastAt:number}>}>} */
  people = {}
  file
  logger
  timer

  constructor({ file, logger }) {
    this.file = file
    this.logger = logger
    try {
      if (existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, 'utf8'))
        if (parsed !== null && typeof parsed === 'object' && parsed.groups !== null && typeof parsed.groups === 'object')
          this.groups = parsed.groups
        if (parsed !== null && typeof parsed === 'object' && parsed.people !== null && typeof parsed.people === 'object')
          this.people = parsed.people
      }
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 好感度文件读取失败，按空表继续：%s', String(error))
    }
    this.rebuildPeople()
    this.decayAll()
  }

  /** 老数据只有按群的表：补一份以 QQ 为键的全局档案，保证跨群/私聊能认出同一个人。 */
  rebuildPeople() {
    let changed = false
    for (const [chatKey, table] of Object.entries(this.groups)) {
      for (const [qq, record] of Object.entries(table)) {
        const person = this.people[qq] ?? (this.people[qq] = {
          qq,
          name: '',
          score: 0,
          msgs: 0,
          lastAt: 0,
          chats: {},
        })
        if (person.name === '' && record.name)
          person.name = record.name
        if ((person.lastAt ?? 0) < (record.lastAt ?? 0))
          person.lastAt = record.lastAt ?? 0
        person.msgs = Math.max(person.msgs ?? 0, record.msgs ?? 0)
        if (person.chats[chatKey] === undefined) {
          person.chats[chatKey] = { name: record.name ?? '', lastAt: record.lastAt ?? 0 }
          changed = true
        }
        if (person.score === 0 && record.score) {
          person.score = record.score
          changed = true
        }
      }
    }
    if (changed)
      this.scheduleSave()
  }

  /** 长期没互动的人，分数慢慢回落到 0 附近。 */
  decayAll() {
    const now = Date.now()
    let changed = false
    for (const people of Object.values(this.groups)) {
      for (const record of Object.values(people)) {
        const days = Math.floor((now - (record.lastAt ?? now)) / 86400000)
        if (days <= 0 || record.score === 0)
          continue
        const step = Math.min(DECAY_CAP, days * DECAY_PER_DAY)
        const next = record.score > 0 ? Math.max(0, record.score - step) : Math.min(0, record.score + step)
        if (next !== record.score) {
          record.score = next
          changed = true
        }
      }
    }
    for (const person of Object.values(this.people)) {
      const days = Math.floor((now - (person.lastAt ?? now)) / 86400000)
      if (days <= 0 || person.score === 0)
        continue
      const step = Math.min(DECAY_CAP, days * DECAY_PER_DAY)
      const next = person.score > 0 ? Math.max(0, person.score - step) : Math.min(0, person.score + step)
      if (next !== person.score) {
        person.score = next
        changed = true
      }
    }
    if (changed)
      this.persist()
  }

  /**
   * 观察一条群消息，更新对说话人的好感度。
   * @param {string} groupId 群号
   * @param {string} userId QQ 号
   * @param {{name?:string, text?:string}} info 说话人与内容
   */
  observe(groupId, userId, info = {}) {
    const group = String(groupId ?? '')
    const uid = String(userId ?? '')
    if (group === '' || uid === '')
      return
    const text = String(info.text ?? '')
    const table = this.groups[group] ?? (this.groups[group] = {})
    const record = table[uid] ?? (table[uid] = { score: 0, msgs: 0, lastAt: 0, name: '', reason: '' })
    const name = String(info.name ?? '').trim()
    if (name !== '')
      record.name = name
    record.msgs += 1
    record.lastAt = Date.now()
    let delta = 1
    let reason = '正常聊天'
    if (PRAISE.some(word => text.includes(word))) {
      delta = 2
      reason = '夸了你'
    }
    else if (INSULT.some(word => text.includes(word))) {
      delta = -3
      reason = '怼了你'
    }
    record.score = clamp((record.score ?? 0) + delta, MIN_SCORE, MAX_SCORE)
    if (reason !== '正常聊天')
      record.reason = reason
    // 全局档案：同一个 QQ 跨群 / 私聊都是同一个人
    const person = this.people[uid] ?? (this.people[uid] = {
      qq: uid,
      name: '',
      score: 0,
      msgs: 0,
      lastAt: 0,
      chats: {},
    })
    if (name !== '')
      person.name = name
    person.msgs = (person.msgs ?? 0) + 1
    person.lastAt = record.lastAt
    person.score = clamp((person.score ?? 0) + delta, MIN_SCORE, MAX_SCORE)
    const chat = person.chats[group] ?? (person.chats[group] = { name: '', lastAt: 0 })
    if (name !== '')
      chat.name = name
    chat.lastAt = record.lastAt
    this.scheduleSave()
  }

  /** 按「分量」排序的关系列表（人格演化要用），带 QQ 号与全局分数。 */
  topRelations(groupId, limit = 6) {
    const table = this.groups[String(groupId ?? '')]
    if (table === undefined)
      return []
    return Object.entries(table)
      .map(([userId, record]) => {
        const person = this.people[userId]
        return {
          userId,
          qq: userId,
          name: String(person?.name || record.name || '').trim(),
          score: person?.score ?? record.score ?? 0,
          chatScore: record.score ?? 0,
          chats: Object.keys(person?.chats ?? {}).length,
          tier: tierOf(person?.score ?? record.score ?? 0),
        }
      })
      .filter(item => item.name !== '')
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
      .slice(0, limit)
  }

  /**
   * 拼一段写进提示词的关系描述；没记录或聊得太少就不打扰模型。
   * 带上 QQ 号，这样换群/私聊时也能认出是同一个人。
   * @returns {string|null}
   */
  formatForPrompt(groupId, userId, name) {
    const key = String(groupId ?? '')
    const uid = String(userId ?? '')
    const record = this.groups[key]?.[uid]
    const person = this.people[uid]
    if (record === undefined && person === undefined)
      return null
    if ((record?.msgs ?? 0) < 1 && (person?.msgs ?? 0) < 1)
      return null
    const display = String(name ?? person?.name ?? record?.name ?? '').trim() || '这个人'
    const score = person?.score ?? record?.score ?? 0
    const tier = tierOf(score)
    const places = Object.keys(person?.chats ?? {}).length
    const last = record?.reason === '' || record?.reason === undefined ? '' : `，最近一次是${record.reason}`
    const tone = tier === '自己人'
      ? '可以随口开玩笑、撒娇、说点只有熟人之间才说的话'
      : tier === '熟人'
        ? '可以放松一点，别太客气'
        : tier === '眼熟'
          ? '眼熟但还不算熟，正常聊就好'
          : '还很陌生，客气一点，别自来熟'
    return `# 你跟「${display}」的关系（QQ ${uid}）\n`
      + `全局印象【${tier}】（好感 ${String(score)}/100${last}）；`
      + `${places > 1 ? `你们在 ${String(places)} 个地方聊过，是同一个人` : '目前只在这里聊过'}。`
      + `在${key.startsWith('private:') ? '私聊' : `群 ${key}`}里的分数 ${String(record?.score ?? 0)}。${tone}。`
      + '好感只是印象，别把分数说出来，也别因为分数低就对人冷淡。'
  }

  scheduleSave() {
    if (this.timer !== undefined)
      return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.persist()
    }, 5000)
    this.timer.unref?.()
  }

  persist() {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify({ version: 2, groups: this.groups, people: this.people }, null, 1))
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 好感度写入失败：%s', String(error))
    }
  }
}
