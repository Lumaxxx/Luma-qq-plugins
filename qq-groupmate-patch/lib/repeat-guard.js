/**
 * [local patch 2026-10-28] 通用防复读：不依赖具体词表。
 *
 * 思路：
 *   1. 归一化（去标点/空白/语气词）后比「字面相似度」——同义改写也能抓到
 *   2. 再比「话题关键词重合」——换了说法但还在讲同一件事，也算重复
 *   3. 只看她最近几条自己说过的话；对方刚提的词不算（那是在接话，不是复读）
 */

const PUNCT = /[\s，,。！？!?、~～…\-—（）()「」“”"'':：;；]/gu
const LEAD_PARTICLES = /^(嗯|哦|好|行|啊|诶|哎|是|对|呀|哈)+/u
const TAIL_PARTICLES = /(吧|呢|啊|了|嘛|呀|哈|呗|哦|喔|咯)+$/u
// 执念检测用的停用单字：虚词、代词、常见动词都不算「话题」
// 人设自带的词不算执念话题，否则正常聊天也会被误拦
const PERSONA_CHARS = new Set('本鱼白饭肥阿圆tokenc'.split(''))
const STOP_CHARS = new Set('的了吧呢啊呀嘛哦喔是我你他她它在有就不也都很大这那个么什和与要会能去说看想觉得到过来下上中为以而而且然后就还被把给让对自己本鱼行嗯好先再又才跟对不对没别还一下点些吃说看想去来好天人话聊玩做用给'.split(''))

const STOP = new Set([
  '我们', '你们', '他们', '什么', '怎么', '这个', '那个', '就是', '不是', '可以', '一个',
  '现在', '今天', '明天', '刚才', '还是', '已经', '因为', '所以', '但是', '如果', '没有',
  '自己', '别人', '大家', '时候', '东西', '事情', '真的', '有点', '一点', '这么', '那么',
])

export function normalizeText(text) {
  return String(text ?? '')
    .replace(PUNCT, '')
    .replace(LEAD_PARTICLES, '')
    .replace(TAIL_PARTICLES, '')
}

function bigrams(text) {
  const set = new Set()
  for (let i = 0; i + 1 < text.length; i += 1)
    set.add(text.slice(i, i + 2))
  return set
}

/** 字面相似度：bigram Jaccard 与 LCS 比率取大者。 */
export function similarity(a, b) {
  const x = normalizeText(a)
  const y = normalizeText(b)
  if (x === '' || y === '')
    return 0
  if (x === y)
    return 1
  const ba = bigrams(x)
  const bb = bigrams(y)
  let shared = 0
  for (const gram of ba)
    if (bb.has(gram))
      shared += 1
  const union = ba.size + bb.size - shared
  const jaccard = union === 0 ? 0 : shared / union
  // LCS 比率：对付「同义改写」
  const dp = new Array(y.length + 1).fill(0)
  for (let i = 1; i <= x.length; i += 1) {
    let prev = 0
    for (let j = 1; j <= y.length; j += 1) {
      const temp = dp[j]
      dp[j] = x[i - 1] === y[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1])
      prev = temp
    }
  }
  const lcs = dp[y.length] / Math.max(x.length, y.length)
  return Math.max(jaccard, lcs)
}

/** 话题关键词：2~4 字的中文片段，去掉高频虚词。 */
export function keywords(text) {
  const body = String(text ?? '').replace(PUNCT, '')
  const out = new Set()
  for (let size = 2; size <= 4; size += 1) {
    for (let i = 0; i + size <= body.length; i += 1) {
      const gram = body.slice(i, i + size)
      if (STOP.has(gram))
        continue
      out.add(gram)
    }
  }
  return out
}

export function keywordOverlap(a, b) {
  const ka = keywords(a)
  const kb = keywords(b)
  if (ka.size === 0 || kb.size === 0)
    return 0
  let shared = 0
  for (const gram of ka)
    if (kb.has(gram))
      shared += 1
  return shared / Math.min(ka.size, kb.size)
}


/**
 * 话题执念检测：最近几条回复里反复出现的词（3 次以上）就算「揪着不放」。
 * 对方没提这个话题时，新回复里带这个词的句子会被剪掉。
 */
export function fixationTopics(recent, minHits = 2) {
  const counts = new Map()
  for (const text of recent) {
    const body = normalizeText(text)
    const seen = new Set()
    // 两字词：跨回复出现 2 次就算执念
    for (let i = 0; i + 2 <= body.length; i += 1) {
      const gram = body.slice(i, i + 2)
      if (STOP.has(gram) || seen.has(gram))
        continue
      if (PERSONA_CHARS.has(gram[0]) || PERSONA_CHARS.has(gram[1]))
        continue
      seen.add(gram)
      counts.set(gram, (counts.get(gram) ?? 0) + 1)
    }
    // 单字：只在不是停用字、也不是人设词时才算
    for (const ch of body) {
      if (STOP_CHARS.has(ch) || PERSONA_CHARS.has(ch) || seen.has(ch))
        continue
      seen.add(ch)
      counts.set(ch, (counts.get(ch) ?? 0) + 1)
    }
  }
  const topics = new Set()
  for (const [gram, hits] of counts)
    if (hits >= minHits)
      topics.add(gram)
  return topics
}


/**
 * 单句内的词句过载：同一个片段连着出现太多次（像「定位定位定位」），
 * 或者整句只有一两个词反复 —— 这是模型卡死的典型形态。
 */
export function degenerateLoop(text, maxRepeat = 3) {
  // 这里用原文（只去标点）：归一化会吃掉「好」「嗯」这类重复单位的开头，反而漏检
  const body = String(text ?? '').replace(PUNCT, '')
  if (body.length < 4)
    return false
  // 连续重复：任意 1~4 字片段连着出现 maxRepeat 次以上
  for (let size = 1; size <= 4; size += 1) {
    for (let i = 0; i + size * maxRepeat <= body.length; i += 1) {
      const unit = body.slice(i, i + size)
      if (unit.trim() === '')
        continue
      let hits = 1
      while (i + size * (hits + 1) <= body.length && body.slice(i + size * hits, i + size * (hits + 1)) === unit)
        hits += 1
      if (hits >= maxRepeat)
        return true
    }
  }
  // 整句词汇量太低：唯一 2 字片段少于 3 种，且句子够长
  const grams = new Set()
  for (let i = 0; i + 2 <= body.length; i += 1)
    grams.add(body.slice(i, i + 2))
  return body.length >= 10 && grams.size <= 3
}

/**
 * 判断一句话是不是在重复最近说过的话。
 * @param {string} candidate 新回复（一句或整段）
 * @param {string[]} recent 最近自己说过的话（从旧到新）
 * @param {string} userText 对方刚说的话（用来排除“接话”）
 */
const ACK_WORDS = new Set(['晚安', '睡', '睡了', '去睡', '好', '行', '嗯', '哦', '拜拜', '88', 'ok', '知道了'])

export function isRepetition(candidate, recent, userText = '') {
  const cand = String(candidate ?? '').trim()
  if (cand === '')
    return false
  const user = String(userText ?? '')
  const nc = normalizeText(cand)
  for (const prev of recent) {
    const np = normalizeText(prev)
    // ① 同类短应答：晚安 / 睡吧 / 嗯 这类，不管换哪个字都算重复
    if (ACK_WORDS.has(nc) && ACK_WORDS.has(np))
      return true
    // ② 包含：短句被上一句整个包住，也算重复（「先睡吧」vs「嗯，睡吧」）
    if (nc.length >= 2 && np.length >= 2 && (nc.includes(np) || np.includes(nc)))
      return true
    // ③ 字面相似：同义改写
    if (similarity(cand, prev) >= 0.5)
      return true
    // ④ 换了说法但还在同一话题：关键词重合高，且对方没提这个话题
    if (keywordOverlap(cand, prev) >= 0.55 && keywordOverlap(cand, user) < 0.3)
      return true
  }
  return false
}

/**
 * 从整段回复里剪掉在重复的句子；全被剪光返回 undefined。
 * @returns {string|undefined}
 */
export function stripRepeats(reply, recent, userText = '') {
  const text = String(reply ?? '').trim()
  if (text === '')
    return reply
  const fixated = fixationTopics(recent)
  const userKeys = keywords(userText)
  const parts = text.split(/(?<=[。！？!?~\n])/u).filter(part => part.trim() !== '')
  const kept = []
  for (const part of parts) {
    if (part.trim().length < 2) {
      kept.push(part)
      continue
    }
    if (degenerateLoop(part)) {
      // 词句过载（同一片段连发三次以上）直接丢
      continue
    }
    if (isRepetition(part, recent, userText))
      continue
    // 话题执念：她已经连着几条在讲这个词，而对方没提，就剪掉
    if (fixated.size > 0) {
      let hitFixated = false
      const userBody = String(userText ?? '')
      for (const topic of fixated) {
        if (part.includes(topic) && !userBody.includes(topic)) {
          hitFixated = true
          break
        }
      }
      if (hitFixated)
        continue
    }
    // 同一句里连着两句自己就重复了，也去掉
    if (isRepetition(part, kept, userText))
      continue
    kept.push(part)
  }
  const out = kept.join('').replace(/\s+/g, ' ').trim()
  return out === '' ? undefined : out
}
