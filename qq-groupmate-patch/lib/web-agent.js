/**
 * [local patch 2026-10-26] 上网查询（browser-use）
 *
 * 群里有人让阿圆「查一下 / 搜一下 / 帮我查 / 上网查 XXX」时，
 * 调用 <WEBAGENT_HOME>\run_ayu.py ask "XXX"，把结果发回群里。
 *
 * 设置页（LUMA）里可以控制：开关、是否显示窗口、最多几步、超时。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const COMMAND_WORDS = ['查一下', '查查', '搜索一下', '搜一下', '帮我查', '上网查', '去查', '搜索', '查']

export class WebAgent {
  constructor({ home = '<WEBAGENT_HOME>', logger, enabled = true, headless = false, maxSteps = 12, timeoutMinutes = 4 } = {}) {
    this.home = home
    this.logger = logger
    this.enabled = enabled !== false
    this.headless = headless === true
    this.maxSteps = Number.isFinite(maxSteps) && maxSteps > 0 ? Math.round(maxSteps) : 12
    this.timeoutMs = (Number.isFinite(timeoutMinutes) && timeoutMinutes > 0 ? timeoutMinutes : 4) * 60 * 1000
    this.python = join(home, '.venv', 'Scripts', 'python.exe')
    this.script = join(home, 'run_ayu.py')
    this.resultFile = join(home, 'last_result.txt')
    this.busy = false
  }

  get available() {
    return existsSync(this.python) && existsSync(this.script)
  }

  /** 从消息里提取查询词；不是查询指令就返回 undefined。 */
  extractQuery(text, aliases = []) {
    let content = String(text ?? '').trim()
    if (content === '')
      return undefined
    for (const alias of aliases) {
      const name = String(alias ?? '').trim()
      if (name !== '' && content.startsWith(name))
        content = content.slice(name.length).trim()
    }
    const hit = COMMAND_WORDS.find(word => content.startsWith(word))
    if (hit === undefined)
      return undefined
    const query = content.slice(hit.length).replace(/^[:：,，\s]+/u, '').trim()
    return query === '' ? undefined : query
  }

  /** 调 browser-use 查一次；返回给群里看的文本。 */
  async ask(query) {
    if (!this.enabled)
      return '本鱼现在没开上网功能（设置 → LUMA 里可以打开）'
    if (!this.available)
      return '本鱼的上网工具没装好（缺少 browser-use-classic）'
    if (this.busy)
      return '本鱼还在查上一个，等会儿再问'

    this.busy = true
    try {
      this.logger?.info?.('qq-groupmate: 上网查询：%s', query)
      return await this.run(query)
    }
    finally {
      this.busy = false
    }
  }

  run(query) {
    return new Promise((resolve) => {
      const args = [this.script, 'ask', query, '--max-steps', String(this.maxSteps)]
      if (this.headless)
        args.push('--headless')

      const env = {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        ANONYMIZED_TELEMETRY: 'false',
      }
      const child = spawn(this.python, args, { cwd: this.home, env, windowsHide: true })
      let stderr = ''
      child.stdout?.on('data', () => {})
      child.stderr?.on('data', (chunk) => { stderr += String(chunk) })

      const timer = setTimeout(() => {
        try {
          child.kill()
        }
        catch {}
        this.logger?.warn?.('qq-groupmate: 上网查询超时：%s', query)
        resolve('查太久了，本鱼先放弃……你换个更具体的问法试试')
      }, this.timeoutMs)

      child.on('close', (code) => {
        clearTimeout(timer)
        if (code !== 0) {
          this.logger?.warn?.('qq-groupmate: 上网查询失败（code=%s）：%s', code, stderr.slice(-400))
          resolve('本鱼这次没查成……等下再试？')
          return
        }
        try {
          const text = readFileSync(this.resultFile, 'utf8').trim()
          resolve(this.trimForChat(text))
        }
        catch {
          resolve('查是查完了，但结果没读出来')
        }
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        this.logger?.warn?.('qq-groupmate: 上网查询启动失败：%s', String(error))
        resolve('本鱼的上网工具启动不了……')
      })
    })
  }

  /** QQ 里别刷屏：保留前几行，太长就截断。 */
  trimForChat(text, maxChars = 380) {
    const lines = String(text ?? '').trim().split('\n').map(line => line.trim()).filter(line => line !== '')
    let out = ''
    for (const line of lines) {
      if ((out + line).length > maxChars)
        break
      out += (out === '' ? '' : '\n') + line
    }
    if (out === '')
      return '查到了，但内容太长……'
    return String(text).length > out.length ? `${out}\n……（完整内容本鱼记着）` : out
  }
}
