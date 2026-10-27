/**
 * [local patch 2026-10-28] 词句权重规划（不是时间衰减，而是「重要度分配」）。
 *
 * 模型说话像在做计划：先给话题分配重要度，再按重要度生成词。
 * 某个词句权重远高于其它词句时，别的词会被它替换、或被硬塞进句子里 —— 就是视频里的塌缩。
 *
 * 这里的做法：
 *   1. 统计她最近回复里各「话题词」的重要度占比（像一张权重表）
 *   2. 某个词占比远超其它词（>1.6 倍中位数，或占三成以上）→ 判定权重过高
 *   3. 直接从输出里删掉它（硬删除），同时把她其它还活着的话题列进提示词
 *      —— 相当于调高其它词的权重，把计划重新拉平
 *   4. 每轮重新算占比：这个词回落到和其它词差不多（≤1.3 倍中位数）就自动放出来
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const PUNCT = /[\s，,。！？!?、~～…\-—（）()「」“”"'':：;；]/gu
const SENTENCE_SPLIT = /(?<=[。！？!?~\n])/u

/** 权重过高判定：占比 ≥ 30%，或 ≥ 中位数的 1.6 倍 */
const OVERWEIGHT_SHARE = 0.3
const OVERWEIGHT_RATIO = 1.6
/** 回落判定：占比 ≤ 中位数的 1.3 倍就算「跟别的词差不多」 */
const BALANCED_RATIO = 1.3

const STOP = new Set([
  '我们', '你们', '他们', '什么', '怎么', '这个', '那个', '就是', '不是', '可以', '一个',
  '现在', '今天', '明天', '刚才', '还是', '已经', '因为', '所以', '但是', '如果', '没有',
  '自己', '别人', '大家', '时候', '东西', '事情', '真的', '有点', '一点', '这么', '那么',
  '觉得', '知道', '感觉', '然后', '而且', '其实', '应该', '可能', '这种', '那种',
])
const PERSONA = new Set('本鱼白饭肥阿圆tokenc'.split(''))
const STOP_CHARS = new Set('的了吧呢啊呀嘛哦喔是我你他她它在有就不也都很大这那个么什和与要会能去说看想觉得到过来下上中为以而而且然后就还被把给让对先再又才跟不没别还一下点些吃天人话聊玩做用给'.split(''))

function clean(text) {
  return String(text ?? '').replace(PUNCT, '')
}

function countOccurrences(haystack, needle) {
  if (needle === '' || haystack === '')
    return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index >= 0) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

function median(values) {
  if (values.length === 0)
    return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * 话题词权重表：把她最近回复里的词组统计成占比（像计划里的重要度）。
 * @returns {Array<{phrase:string, count:number, share:number}>}
 */
export function topicWeights(recentOwn, maxItems = 12) {
  const bodies = recentOwn.map(clean).filter(text => text !== '')
  if (bodies.length === 0)
    return []
  const counts = new Map()
  for (const body of bodies) {
    const seen = new Set()
    for (let size = 2; size <= 4; size += 1) {
      for (let i = 0; i + size <= body.length; i += 1) {
        const gram = body.slice(i, i + size)
        if (STOP.has(gram) || seen.has(gram))
          continue
        if ([...gram].some(ch => PERSONA.has(ch)))
          continue
        seen.add(gram)
        counts.set(gram, (counts.get(gram) ?? 0) + 1)
      }
    }
    // 单字兜底（睡觉/睡吧/睡了 被拆开的情况）
    const seenChars = new Set()
    for (const ch of body) {
      if (seenChars.has(ch) || PERSONA.has(ch) || STOP_CHARS.has(ch))
        continue
      seenChars.add(ch)
      counts.set(ch, (counts.get(ch) ?? 0) + 1)
    }
  }
  // 去掉被更长词组覆盖的短词，避免重复计权
  const phrases = [...counts.keys()].sort((a, b) => b.length - a.length)
  const kept = []
  for (const phrase of phrases) {
    const covered = kept.some(longer => longer.includes(phrase) && counts.get(longer) >= counts.get(phrase))
    if (covered)
      continue
    kept.push(phrase)
  }
  const total = kept.reduce((sum, phrase) => sum + counts.get(phrase), 0) || 1
  return kept
    .map(phrase => ({ phrase, count: counts.get(phrase), share: counts.get(phrase) / total }))
    .sort((a, b) => b.share - a.share)
    .slice(0, maxItems)
}


function phraseCounts(text) {
  const body = clean(text)
  const counts = new Map()
  const seen = new Set()
  for (let size = 2; size <= 3; size += 1) {
    for (let i = 0; i + size <= body.length; i += 1) {
      const gram = body.slice(i, i + size)
      if (STOP.has(gram) || seen.has(gram))
        continue
      if ([...gram].some(ch => PERSONA.has(ch)))
        continue
      seen.add(gram)
      counts.set(gram, countOccurrences(body, gram))
    }
  }
  const seenChars = new Set()
  for (const ch of body) {
    if (seenChars.has(ch) || PERSONA.has(ch) || STOP_CHARS.has(ch))
      continue
    seenChars.add(ch)
    counts.set(ch, countOccurrences(body, ch))
  }
  return counts
}

/**
 * 概率自增强检测：某个词在她的回复里「一条比一条多」。
 *
 * 自回归模型里，同一个词出现越多 → 后文生成它的概率越高 → 越说越多。
 * 这里看趋势，而不是看总量：1→2→3 这种递增就是早期信号，提前掐。
 *
 * @param {string[]} recentOwn 她最近的回复（从旧到新）
 * @returns {Array<{phrase:string, series:number[]}>}
 */
export function escalatingPhrases(recentOwn, window = 4) {
  const texts = recentOwn.slice(-window)
  if (texts.length < 3)
    return []
  const series = texts.map(phraseCounts)
  const last = series[series.length - 1]
  const out = []
  for (const [phrase, count] of last) {
    const seq = series.map(map => map.get(phrase) ?? 0)
    const [a, b, c] = seq.slice(-3)
    const rising = b > a && c > b && c >= 2
    const sticky = c >= 3 && b >= 2 && a >= 1
    if (rising || sticky)
      out.push({ phrase, series: seq })
  }
  out.sort((x, y) => y.series[y.series.length - 1] - x.series[x.series.length - 1])
  return out.slice(0, 3)
}

/** 兼容旧调用：找「她反复说、但对方没提」的词。 */
export function suspectPhrases(recentOwn, recentUser, maxItems = 3) {
  const userText = recentUser.join(' ')
  const weights = topicWeights(recentOwn, 12)
  return weights
    .filter(item => item.count >= 2 && !userText.includes(item.phrase))
    .slice(0, maxItems)
    .map(item => item.phrase)
}

export class WordClipper {
  constructor({ file, logger, ratio } = {}) {
    this.file = file
    this.logger = logger
    this.ratio = Number(ratio) > 0 ? Number(ratio) : BALANCED_RATIO
    /** @type {Map<string, Array<{phrase:string, at:number, strikes:number}>>} */
    this.clips = new Map()
    this.load()
  }

  load() {
    try {
      if (!this.file || !existsSync(this.file))
        return
      const data = JSON.parse(readFileSync(this.file, 'utf8'))
      for (const [scope, list] of Object.entries(data?.clips ?? {})) {
        if (!Array.isArray(list))
          continue
        this.clips.set(scope, list
          .map(item => (typeof item === 'string'
            ? { phrase: item, at: Date.now(), strikes: 1 }
            : { phrase: String(item?.phrase ?? ''), at: Number(item?.at ?? Date.now()), strikes: Number(item?.strikes ?? 1) }))
          .filter(item => item.phrase.length >= 1))
      }
    }
    catch { /* 坏了就空表 */ }
  }

  save() {
    if (!this.file)
      return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, `${JSON.stringify({ clips: Object.fromEntries(this.clips) }, null, 2)}\n`, 'utf8')
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 删除名单写入失败：%s', String(error))
    }
  }

  /**
   * 当前真正压制哪些词：按「重要度占比」判断，而不是时间。
   * @param {string[]} recentOwn 她最近的回复
   */
  active(scope, recentOwn = [], recentUser = []) {
    const list = this.clips.get(scope) ?? []
    if (list.length === 0)
      return []
    const ownBody = recentOwn.map(clean).join(' ')
    const userBody = recentUser.map(clean).join(' ')
    const banned = new Set(list.map(item => item.phrase))
    // 其它话题的最高出现次数（当「正常权重」的基准）
    const weights = topicWeights(recentOwn, 16)
    const otherMax = Math.max(0, ...weights
      .filter(item => ![...banned].some(phrase => item.phrase.includes(phrase) || phrase.includes(item.phrase)))
      .map(item => item.count))
    const kept = []
    for (const item of list) {
      const freq = countOccurrences(ownBody, item.phrase)
      // 群友自己在聊这个话题 → 必要词，不压制
      if (countOccurrences(userBody, item.phrase) >= 2) {
        this.logger?.info?.('qq-groupmate: 「%s」是群友在聊的话题，不压制（%s）', item.phrase, scope)
        continue
      }
      // 不再出现，或出现次数已经跟别的词差不多 → 放出来
      const balanced = freq === 0 || freq <= Math.max(1, otherMax) * this.ratio
      if (balanced) {
        this.logger?.info?.('qq-groupmate: 「%s」权重已跟其它词持平，恢复输出（%s）', item.phrase, scope)
        continue
      }
      kept.push(item)
    }
    if (kept.length !== list.length) {
      this.clips.set(scope, kept)
      this.save()
    }
    return kept
  }

  list(scope, recentOwn = []) {
    return this.active(scope, recentOwn).map(item => item.phrase)
  }

  /** 这个词现在是不是权重过高（占比超过阈值）。 */
  isOverweight(scope, recentOwn) {
    const list = this.clips.get(scope) ?? []
    if (list.length === 0)
      return []
    const ownBody = recentOwn.map(clean).join(' ')
    const weights = topicWeights(recentOwn, 16)
    const otherMax = Math.max(0, ...weights.map(item => item.count)) || 1
    return list.filter((item) => {
      const freq = countOccurrences(ownBody, item.phrase)
      return freq > otherMax * OVERWEIGHT_RATIO || freq >= 3
    })
  }

  has(scope, text, recentOwn = [], recentUser = []) {
    return this.active(scope, recentOwn, recentUser).some(item => String(text ?? '').includes(item.phrase))
  }

  /** 加进压制名单：同词再犯 → 记一次 strikes（提高压制优先级）。 */
  clip(scope, phrase) {
    const words = String(phrase ?? '').trim()
    if (words.length < 1)
      return false
    const now = Date.now()
    const list = [...(this.clips.get(scope) ?? [])]
    const add = [words]
    const root = words.replace(/(吧|呢|啊|了|嘛|呀|哈|呗)$/u, '')
    if (root !== words && root.length >= 1)
      add.push(root)
    let changed = false
    for (const item of add) {
      const found = list.find(entry => entry.phrase === item)
      if (found === undefined) {
        list.push({ phrase: item, at: now, strikes: 1 })
        changed = true
      }
      else {
        found.strikes += 1
        found.at = now
        changed = true
      }
    }
    this.clips.set(scope, list.slice(0, 20))
    if (changed)
      this.save()
    return changed
  }

  /**
   * 硬删除：剪掉含压制词的句子；句子还剩内容就保留剩下的。
   */
  cut(scope, reply, recentOwn = [], recentUser = []) {
    const list = this.active(scope, recentOwn, recentUser)
    if (list.length === 0)
      return reply
    const text = String(reply ?? '')
    const parts = text.split(SENTENCE_SPLIT).filter(part => part.trim() !== '')
    const kept = []
    let hitAny = false
    for (const part of parts) {
      const hit = list.some(item => part.includes(item.phrase))
      if (!hit) {
        kept.push(part)
        continue
      }
      hitAny = true
      let rest = part
      for (const item of list)
        rest = rest.split(item.phrase).join('')
      rest = rest.replace(/^[，,、\s]+/u, '').replace(/[，,、\s]+$/u, '').trim()
      if (clean(rest).length >= 4)
        kept.push(rest)
    }
    if (hitAny) {
      for (const item of list)
        item.at = Date.now()
      this.save()
    }
    const out = kept.join('').replace(/\s+/g, ' ').trim()
    return out === '' ? undefined : out
  }

  /** 抹掉历史里含压制词的句子。 */
  scrubText(scope, text, recentOwn = [], recentUser = []) {
    const list = this.active(scope, recentOwn, recentUser)
    if (list.length === 0)
      return text
    const parts = String(text ?? '').split(SENTENCE_SPLIT)
    return parts.filter(part => !list.some(item => part.includes(item.phrase))).join('').trim()
  }

  /**
   * 群友的消息里如果反复出现被压制的词，只保留第一次，其余抹掉。
   * 上下文里这个字越少，模型下一次生成它的概率就越低（断掉自增强的燃料）。
   */
  scrubUser(scope, text, recentOwn = [], recentUser = []) {
    const list = this.active(scope, recentOwn, recentUser)
    if (list.length === 0)
      return text
    // 按句子处理：每个词最多留 2 次，后面的句子整句丢掉（避免把词拆坏）
    const parts = String(text ?? '').split(SENTENCE_SPLIT)
    const budget = new Map(list.map(item => [item.phrase, 2]))
    const kept = []
    for (const part of parts) {
      let drop = false
      for (const item of list) {
        const left = budget.get(item.phrase) ?? 0
        if (left <= 0 && part.includes(item.phrase)) {
          drop = true
          break
        }
      }
      if (drop)
        continue
      for (const item of list) {
        const used = countOccurrences(part, item.phrase)
        if (used > 0)
          budget.set(item.phrase, Math.max(0, (budget.get(item.phrase) ?? 0) - used))
      }
      kept.push(part)
    }
    return kept.join('').trim()
  }

  /**
   * 把「其它还活着的话题」列出来，调高它们的权重，压过那个过热的词。
   * 这是「提高其它词句权重」那一半，和硬删除配合使用。
   */
  balanceHint(scope, recentOwn, recentUser) {
    const list = this.active(scope, recentOwn)
    if (list.length === 0)
      return undefined
    const banned = new Set(list.map(item => item.phrase))
    const weights = topicWeights(recentOwn, 12)
      .filter(item => !banned.has(item.phrase) && item.count >= 1)
      .slice(0, 5)
      .map(item => `「${item.phrase}」`)
    const userTopics = topicWeights(recentUser, 6)
      .filter(item => !banned.has(item.phrase))
      .slice(0, 3)
      .map(item => `「${item.phrase}」`)
    const topics = [...new Set([...userTopics, ...weights])]
    if (topics.length === 0)
      return undefined
    return '# 这轮多聊点别的\n'
      + '刚才有个词句权重压得太狠，先别用它。把注意力分给这些话题：'
      + `${topics.join('、')}。像正常人一样，一两个话题就够，别堆。`
  }
}
