/**
 * [local patch 2026-10-27] 多图拼图：一条消息里 2~3 张图合成一张，省一次调用。
 *
 * 2 张横排，3~4 张 2x2 网格；统一缩放到 560 宽再拼，最终 JPEG。
 * 借宿主自带 python + Pillow；失败返回 undefined，调用方继续用原图。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CELL_WIDTH = 560

const PY_CODE = `
import sys, json
from PIL import Image
args = sys.argv[1:]
cellw = int(args[0]); out = args[1]; paths = args[2:]
ims = []
for p in paths:
    im = Image.open(p).convert('RGB')
    ratio = cellw / float(im.width)
    im = im.resize((cellw, max(1, int(im.height * ratio))), Image.LANCZOS)
    ims.append(im)
cols = 1 if len(ims) == 1 else (2 if len(ims) >= 3 else len(ims))
rows = (len(ims) + cols - 1) // cols
cw = cellw * cols
rh = [max([im.height for im in ims[r*cols:(r+1)*cols]] or [1]) for r in range(rows)]
canvas = Image.new('RGB', (cw, sum(rh)), (255, 255, 255))
y = 0
for r in range(rows):
    row = ims[r*cols:(r+1)*cols]
    for i, im in enumerate(row):
        canvas.paste(im, (i * cellw, y))
    y += rh[r]
canvas.thumbnail((1600, 1600))
canvas.save(out, 'JPEG', quality=82)
print('ok')
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

/** @returns {{buffer: Buffer, mime: string, count: number}|undefined} */
export function gridImages(buffers, logger) {
  const list = (buffers ?? []).filter(Boolean)
  if (list.length < 2)
    return undefined
  const python = bundledPython()
  if (python === undefined)
    return undefined
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`
  const paths = list.map((buffer, index) => {
    const file = join(tmpdir(), `qqgm-grid-${stamp}-${index}.img`)
    writeFileSync(file, buffer)
    return file
  })
  const out = join(tmpdir(), `qqgm-grid-${stamp}.jpg`)
  try {
    const result = spawnSync(python, ['-c', PY_CODE, String(CELL_WIDTH), out, ...paths], { encoding: 'utf8', timeout: 20000, windowsHide: true })
    if (result.status !== 0 || !existsSync(out))
      return undefined
    const data = readFileSync(out)
    logger?.info?.('qq-groupmate: %s 张图拼成一张（%s 字节）', String(list.length), String(data.length))
    return { buffer: data, mime: 'image/jpeg', count: list.length }
  }
  catch {
    return undefined
  }
  finally {
    for (const path of [...paths, out]) {
      try {
        writeFileSync(path, '')
      }
      catch { /* 忽略 */ }
    }
  }
}
