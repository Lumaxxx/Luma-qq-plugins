/**
 * 群黑话词典（本地补丁，2026-10-22）
 *
 * 目标：让机器人听懂群里自己造的词。
 *
 * 判据刻意保守——只收「群友自己给过定义」的词，不做无监督扒词：
 *   「yyds 就是永远的神」「这词儿的意思是摸鱼」「odo=哦对了」
 * 好处是零误收、零模型成本；坏处是覆盖率靠群友肯解释。
 * 模型不确定时可以先用 [搜索:] 求证，确认后再进来（未来可扩展）。
 *
 * 文件：<数据目录>/slang.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * [local patch 2026-10-27] 判据收紧：只认「被引号括起来」或「含 ASCII」的术语。
 * 否则「这不就是刚才那两条数据的翻车现场吗」会把「这不」当黑话收进去。
 */
function looksLikeJargon(term, body) {
    if (/[A-Za-z0-9]/u.test(term))
        return true;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`[「“"【]\\s*${escaped}\\s*[」”"】]`, 'u').test(body);
}

/** 含义不能是半句话。 */
function looksLikeMeaning(meaning) {
    if (/[吗呢吧啊呀哦嘛]$/u.test(meaning))
        return false;
    if (/^(一个|个|这|那|你|我|他|她)/u.test(meaning))
        return false;
    return true;
}

/** 定义句式：X 就是/是/指的是/意思是 Y，或 X = Y。 */
const DEF_PATTERNS = [
  /([\u4e00-\u9fa5A-Za-z0-9_]{1,8})\s*(?:就是|指的是|意思是|意为|意思是说)\s*([^\s，。！？!?,]{1,24})/u,
  /([\u4e00-\u9fa5A-Za-z0-9_]{1,8})\s*(?:是)\s*([^\s，。！？!?,]{2,24})(?:的意思|的缩写)/u,
  /([\u4e00-\u9fa5A-Za-z0-9_]{1,8})\s*[=＝]\s*([^\s，。！？!?,]{1,24})/u,
]

/** 这些词常常是定义句式的「主语噪音」，别当黑话收。 */
const STOPWORDS = new Set([
  '这', '那', '这个', '那个', '什么', '意思', '真的', '就是', '不是', '我们', '你们', '他们',
  '今天', '明天', '昨天', '现在', '刚才', '刚刚', '然后', '所以', '但是', '因为', '可以',
  '知道', '觉得', '可能', '应该', '还是', '已经', '一个', '一下', '这个', '那个', '问题',
  '如果', '没有', '自己', '别人', '大家', '本鱼', '大肥鱼',
  '这不', '那本', '本身', '看见', '图上', '装反', '她的名字', '阿圆',
])

const MAX_TERMS_PER_GROUP = 400

const clampStr = (value, max) => String(value ?? '').trim().slice(0, max)

export class SlangStore {
  /** @type {Record<string, Record<string, {meaning:string, hits:number, firstAt:number, lastAt:number, example:string}>>} */
  groups = {}
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
      }
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 黑话词典读取失败，按空表继续：%s', String(error))
    }
  }

  /**
   * 观察一条群消息，命中定义句式就记一条词义。
   * @returns {{term:string, meaning:string}|null} 新收录或更新时返回条目
   */
  observe(groupId, text) {
    const group = String(groupId ?? '')
    const body = String(text ?? '').trim()
    if (group === '' || body === '' || body.length > 200)
      return null
    for (const pattern of DEF_PATTERNS) {
      const match = pattern.exec(body)
      if (match === null)
        continue
      const term = clampStr(match[1], 8).toLowerCase()
      const meaning = clampStr(match[2], 24)
      if (term === '' || meaning === '' || term.length < 2)
        continue
                  // [local patch 2026-10-27] 只收真术语，别把句子碎片当黑话
            if (!looksLikeJargon(term, body) || !looksLikeMeaning(meaning))
                continue
            if (meaning.length > 16)
                continue
if (STOPWORDS.has(term) || /^\d+$/u.test(term) || meaning === term)
        continue
      // 「X 是 Y」里 Y 常常是半句话，太短太泛就跳过
      if (meaning.length < 2)
        continue
      const table = this.groups[group] ?? (this.groups[group] = {})
      const now = Date.now()
      const record = table[term]
      if (record === undefined) {
        if (Object.keys(table).length >= MAX_TERMS_PER_GROUP)
          return null
        table[term] = { meaning, hits: 1, firstAt: now, lastAt: now, example: body.slice(0, 60) }
        this.logger?.info?.('qq-groupmate: 收录黑话「%s」= %s', term, meaning)
        this.scheduleSave()
        return { term, meaning }
      }
      // 已有词：含义变了就更新，否则只累加命中
      if (record.meaning !== meaning)
        record.meaning = meaning
      record.hits += 1
      record.lastAt = now
      this.scheduleSave()
      return { term, meaning }
    }
    return null
  }

  /** 当前消息里命中的黑话（最多 5 条），拼成提示词片段。 */
  formatForPrompt(groupId, text) {
    const table = this.groups[String(groupId ?? '')]
    if (table === undefined)
      return null
    const body = String(text ?? '').toLowerCase()
    const hits = []
    for (const [term, record] of Object.entries(table)) {
      if (body.includes(term))
        hits.push({ term, meaning: record.meaning })
      if (hits.length >= 5)
        break
    }
    if (hits.length === 0)
      return null
    return '# 群里的黑话\n'
      + hits.map(item => `- 「${item.term}」：${item.meaning}`).join('\n')
      + '\n这些是这群人自己说的意思，按这个理解，别拿通用含义硬套。'
  }

  /** 最近收录的若干条（注入给模型当背景知识，可选）。 */
  recent(groupId, limit = 5) {
    const table = this.groups[String(groupId ?? '')]
    if (table === undefined)
      return []
    return Object.entries(table)
      .sort((a, b) => (b[1].lastAt ?? 0) - (a[1].lastAt ?? 0))
      .slice(0, limit)
      .map(([term, record]) => ({ term, meaning: record.meaning }))
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
      writeFileSync(this.file, JSON.stringify({ version: 1, groups: this.groups }, null, 1))
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 黑话词典写入失败：%s', String(error))
    }
  }
}
