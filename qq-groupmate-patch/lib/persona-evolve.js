/**
 * 人格演化（本地补丁，2026-10-22）
 *
 * 设计取舍：演化**不调用模型**，而是从真实数据里推算「行为倾向」：
 *   - 关系：谁是自己人、谁有点僵（来自 affinity.json）
 *   - 语言：最近收录/高频的群黑话（来自 slang.json）
 *   - 活跃度：这个群最近聊得多不多（来自消息历史长度）
 * 好处是可解释、零成本、不会演化出「违反角色底线」的内容；
 * 坏处是它只会「调整语气与偏好」，不会长出全新的爱好。
 *
 * 每次生成都是一代快照，最多保留 5 代，可回滚。
 * 文件：<数据目录>/persona-evolution.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const MAX_VERSIONS = 5
/** 每多少条历史才重新评估一次（避免每轮都算）。 */
const REFRESH_EVERY = 60

export class PersonaEvolver {
  /** @type {Record<string, {current:number, versions:{at:number, text:string, src:string}[], lastCount:number}>} */
  groups = {}
  file
  logger

  constructor({ file, logger, refreshEvery = REFRESH_EVERY }) {
    this.file = file
    this.logger = logger
    this.refreshEvery = Math.max(20, Number(refreshEvery) || REFRESH_EVERY)
    try {
      if (existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, 'utf8'))
        if (parsed !== null && typeof parsed === 'object' && parsed.groups !== null && typeof parsed.groups === 'object')
          this.groups = parsed.groups
      }
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 人格演化文件读取失败，按空表继续：%s', String(error))
    }
  }

  /** 根据当前数据生成一代人格描述（纯函数，方便测试）。 */
  build({ relations = [], slang = [], historyCount = 0 }) {
    const lines = []
    const label = item => {
      const name = String(item.name ?? '').trim()
      const qq = String(item.qq ?? item.userId ?? '').trim()
      if (name === '' && qq === '')
        return ''
      return qq === '' ? name : `${name === '' ? '某人' : name}（QQ ${qq}，${item.tier}）`
    }
    const close = relations.filter(item => item.score >= 10).slice(0, 3)
    const cold = relations.filter(item => item.score < 0).slice(0, 2)
    if (close.length > 0)
      lines.push(`- 你跟 ${close.map(label).join('、')} 已经很熟，说话可以更随意、会开玩笑、偶尔撒娇`)
    if (cold.length > 0)
      lines.push(`- ${cold.map(item => item.name || item.userId).join('、')} 让你不太舒服，可以摆脸色，但别骂人`)
    // 关系概览：没有熟人也要知道自己跟这群人熟到什么程度（之前只在 >=10 时才输出，导致几乎永不演化）
    const familiar = relations.filter(item => item.score >= 3 && item.score < 10).slice(0, 3)
    if (close.length === 0 && familiar.length > 0)
      lines.push(`- 你跟 ${familiar.map(item => item.name || item.userId).join('、')} 已经混了个脸熟，可以比陌生人随意一点`)
    const fresh = slang.slice(0, 4)
    if (fresh.length > 0)
      lines.push(`- 这群人的说法你已经在用了：${fresh.map(item => `${item.term}（${item.meaning}）`).join('、')}`)
    // 活跃度：始终给一条，保证每次演化都有内容
    if (historyCount >= 120)
      lines.push('- 这个群聊得很热，你可以更主动接话、更爱玩')
    else if (historyCount >= 30)
      lines.push('- 这个群聊得正常，跟着节奏接话就行')
    else if (historyCount > 0)
      lines.push('- 这个群最近比较安静，别自说自话，等有人叫你')
    else
      lines.push('- 你刚来这个群，先观察别人怎么说话')
    return lines.join('\n')
  }

  /**
   * 数据变了就生成新一代。
   * @returns {{version:number, text:string}|null} 没变化返回 null
   */
  autoRefresh(groupId, inputs) {
    const group = String(groupId ?? '')
    if (group === '')
      return null
    const state = this.groups[group] ?? (this.groups[group] = { current: 0, versions: [], lastCount: 0 })
    const count = inputs.historyCount ?? 0
    if (count - state.lastCount < this.refreshEvery && state.versions.length > 0)
      return null
    const text = this.build(inputs)
    if (text === null)
      return null
    const last = state.versions[state.current]
    if (last !== undefined && last.text === text) {
      state.lastCount = count
      return null
    }
    state.versions.push({ at: Date.now(), text, src: 'auto' })
    if (state.versions.length > MAX_VERSIONS)
      state.versions = state.versions.slice(-MAX_VERSIONS)
    state.current = state.versions.length - 1
    state.lastCount = count
    this.persist()
    this.logger?.info?.('qq-groupmate: 人格演化到第 %s 代', String(state.current + 1))
    return { version: state.current + 1, text }
  }

  /** 当前这一代的提示词片段。 */
  formatForPrompt(groupId) {
    const state = this.groups[String(groupId ?? '')]
    const version = state?.versions?.[state.current]
    if (version === undefined || version.text === '')
      return null
    return `# 你最近的变化（第 ${String(state.current + 1)} 代）\n`
      + `${version.text}\n`
      + '这些是你跟这群人相处久了自己长出来的习惯，自然点用；但它们不能压过你的人物设定和底线。'
  }

  /** 回滚到上一代（或指定代数，1-based）。 */
  rollback(groupId, version) {
    const state = this.groups[String(groupId ?? '')]
    if (state === undefined || state.versions.length === 0)
      return { ok: false, reason: '没有可回滚的版本' }
    const target = version === undefined ? state.current - 1 : version - 1
    if (target < 0 || target >= state.versions.length)
      return { ok: false, reason: '版本号超出范围' }
    state.current = target
    this.persist()
    return { ok: true, version: target + 1, text: state.versions[target].text }
  }

  listVersions(groupId) {
    const state = this.groups[String(groupId ?? '')]
    if (state === undefined)
      return []
    return state.versions.map((item, index) => ({
      version: index + 1,
      at: item.at,
      current: index === state.current,
      text: item.text,
    }))
  }

  persist() {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify({ version: 1, groups: this.groups }, null, 1))
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 人格演化写入失败：%s', String(error))
    }
  }
}
