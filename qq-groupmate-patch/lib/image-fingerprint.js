/**
 * [local patch 2026-10-27] 图片指纹：dHash（64 位差分哈希）+ 表情包索引。
 *
 * 用途：
 *   1. 判断群里发的图是不是本地表情包库里的某一张（命中就不用调视觉模型）
 *   2. 给「同一张图」一个稳定的短指纹（表情包转发、截图重复）
 *
 * 计算借宿主自带的 python + Pillow，一次调用批量算，避免每张图 spawn 一次。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'

const STICKER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const HAMMING_MAX = 6

const PY_SCRIPT = `
import sys, json
from PIL import Image
out = {}
for path in sys.argv[1:]:
    try:
        im = Image.open(path).convert('L').resize((9, 8))
        px = list(im.getdata())
        bits = 0
        for r in range(8):
            row = r * 9
            for c in range(8):
                if px[row + c] > px[row + c + 1]:
                    bits = (bits << 1) | 1
                else:
                    bits = bits << 1
        out[path] = format(bits, '016x')
    except Exception:
        out[path] = ''
print(json.dumps(out))
`

function bundledPython() {
  try {
    const deps = join(process.execPath, '..', '..', '..')
    const candidate = join(deps, 'python', 'python.exe')
    return existsSync(candidate) ? candidate : undefined
  }
  catch {
    return undefined
  }
}

/** 批量算 dHash；返回与入参顺序一致的数组（失败位置为 undefined）。 */
export function dHashes(buffers) {
  const list = (buffers ?? []).filter(Boolean)
  if (list.length === 0)
    return []
  const python = bundledPython()
  if (python === undefined)
    return list.map(() => undefined)

  const stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`
  const paths = list.map((buffer, index) => {
    const file = join(tmpdir(), `qqgm-hash-${stamp}-${index}.img`)
    writeFileSync(file, buffer)
    return file
  })
  try {
    const result = spawnSync(python, ['-c', PY_SCRIPT, ...paths], { encoding: 'utf8', timeout: 20000, windowsHide: true })
    if (result.status !== 0 || !result.stdout)
      return list.map(() => undefined)
    const map = JSON.parse(result.stdout)
    return paths.map(path => (map[path] === '' ? undefined : map[path]))
  }
  catch {
    return list.map(() => undefined)
  }
  finally {
    for (const path of paths) {
      try {
        writeFileSync(path, '')
      }
      catch { /* 忽略 */ }
    }
  }
}

function hamming(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length)
    return 64
  let x = (Number.parseInt(a, 16) ^ Number.parseInt(b, 16)) >>> 0
  let count = 0
  while (x !== 0) {
    x &= x - 1
    count += 1
  }
  return count
}

/** 表情包索引：文件名就是表情名，dHash 距离足够近就算命中。 */
export class StickerIndex {
  constructor({ dir, file, logger }) {
    this.dir = dir
    this.file = file
    this.logger = logger
    this.entries = []
    this.loaded = false
  }

  rebuild() {
    this.entries = []
    if (!this.dir || !existsSync(this.dir))
      return
    const files = readdirSync(this.dir).filter(name => STICKER_EXTENSIONS.has(extname(name).toLowerCase()))
    if (files.length === 0)
      return
    const buffers = []
    const names = []
    for (const name of files) {
      try {
        buffers.push(readFileSync(join(this.dir, name)))
        names.push(name.replace(/\.[^.]+$/u, ''))
      }
      catch { /* 忽略坏文件 */ }
    }
    const hashes = dHashes(buffers)
    for (let index = 0; index < hashes.length; index += 1) {
      if (hashes[index] !== undefined && names[index] !== undefined)
        this.entries.push({ hash: hashes[index], name: names[index] })
    }
    this.loaded = true
    this.save()
    this.logger?.info?.('qq-groupmate: 表情包索引 %s 张', String(this.entries.length))
  }

  load() {
    if (this.loaded)
      return
    try {
      if (this.file && existsSync(this.file)) {
        const data = JSON.parse(readFileSync(this.file, 'utf8'))
        const dirMtime = this.dir && existsSync(this.dir) ? statSync(this.dir).mtimeMs : 0
        if (data?.dirMtime === dirMtime && Array.isArray(data.entries)) {
          this.entries = data.entries
          this.loaded = true
          return
        }
      }
    }
    catch { /* 坏了就重建 */ }
    this.rebuild()
  }

  save() {
    if (!this.file)
      return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const dirMtime = this.dir && existsSync(this.dir) ? statSync(this.dir).mtimeMs : 0
      writeFileSync(this.file, `${JSON.stringify({ dirMtime, entries: this.entries }, null, 2)}\n`, 'utf8')
    }
    catch { /* 忽略 */ }
  }

  /** 用一张图的 hash 找最像的表情包名；没有就 undefined。 */
  match(hash) {
    this.load()
    if (hash === undefined || this.entries.length === 0)
      return undefined
    let best
    let bestDistance = HAMMING_MAX + 1
    for (const entry of this.entries) {
      const distance = hamming(hash, entry.hash)
      if (distance < bestDistance) {
        bestDistance = distance
        best = entry
      }
    }
    return bestDistance <= HAMMING_MAX ? best.name : undefined
  }
}
