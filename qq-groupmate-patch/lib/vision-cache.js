/**
 * [local patch 2026-10-27] 识图缓存：同一张图只让模型看一次。
 *
 * 按图片内容 sha256 存「这张图是什么」，下次同图直接引用文字描述，
 * 不再消耗视觉 token（对标主流多模态服务的 image memory 做法）。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const TTL_MS = 45 * 24 * 3600 * 1000
const MAX_ENTRIES = 500

export class VisionCache {
  constructor({ file, logger } = {}) {
    this.file = file
    this.logger = logger
    this.map = new Map()
    this.dirty = false
    this.load()
  }

  static hash(buffer) {
    if (buffer === undefined || buffer === null)
      return undefined
    return createHash('sha256').update(buffer).digest('hex').slice(0, 32)
  }

  load() {
    try {
      if (!this.file || !existsSync(this.file))
        return
      const data = JSON.parse(readFileSync(this.file, 'utf8'))
      const now = Date.now()
      for (const [key, value] of Object.entries(data?.entries ?? {})) {
        if (typeof value?.desc === 'string' && now - Number(value.at ?? 0) < TTL_MS)
          this.map.set(key, value)
      }
    }
    catch {
      // 缓存坏了就当空的
    }
  }

  get(hash) {
    if (hash === undefined)
      return undefined
    const hit = this.map.get(hash)
    if (hit === undefined)
      return undefined
    if (Date.now() - Number(hit.at ?? 0) > TTL_MS) {
      this.map.delete(hash)
      return undefined
    }
    return hit
  }

  set(hash, desc) {
    if (hash === undefined || typeof desc !== 'string' || desc.trim() === '')
      return
    this.map.delete(hash)
    this.map.set(hash, { desc: desc.trim().slice(0, 300), at: Date.now() })
    while (this.map.size > MAX_ENTRIES) {
      const oldest = this.map.keys().next().value
      this.map.delete(oldest)
    }
    this.dirty = true
    this.saveSoon()
  }

  saveSoon() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.save(), 1500)
    this.timer.unref?.()
  }

  save() {
    if (!this.dirty || !this.file)
      return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, `${JSON.stringify({ version: 1, entries: Object.fromEntries(this.map) }, null, 2)}\n`, 'utf8')
      this.dirty = false
    }
    catch (error) {
      this.logger?.warn?.('qq-groupmate: 识图缓存写入失败：%s', String(error))
    }
  }
}
