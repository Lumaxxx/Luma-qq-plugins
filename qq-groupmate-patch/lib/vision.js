/**
 * 识图：把 QQ 消息里的图片取下来，转成 `data:` URL 交给视觉模型。
 *
 * 取图有两条路：消息段里自带 `url` 就直接下；没有就调 OneBot 的 `get_image` 换一个地址。
 * 单张超过上限、或者取不到，就跳过这张（记一条日志），不影响这条消息的其它内容。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * 视觉模型明确拒绝过的图片格式（比如有的中转站不收 GIF）。
 * 记下来之后同类图片就不再往请求里塞，省一次注定失败的调用。
 */
const rejectedMimes = new Set();
/** [local patch 2026-10-22] 超过这个大小就先压缩，再送给模型。 */
const COMPRESS_THRESHOLD_BYTES = 700 * 1024;
/** 压缩目标：长边 1280、JPEG 质量自适应，最终控制在 1 MB 内。 */
const COMPRESS_MAX_SIDE = 1280;
const COMPRESS_TARGET_BYTES = 1024 * 1024;

/** 找宿主自带的 python（node.exe 在 .../dependencies/node/bin/ 下）。 */
function bundledPython() {
    try {
        const deps = dirname(dirname(dirname(process.execPath)));
        const candidate = join(deps, 'python', 'python.exe');
        return existsSync(candidate) ? candidate : undefined;
    }
    catch {
        return undefined;
    }
}

/**
 * [local patch 2026-10-22] 用 Pillow 压图：RGBA 转白底、长边缩到 1280、JPEG 质量递减。
 * 失败返回 undefined，调用方继续用原图。
 */
export function compressImage(buffer, logger) {
    const python = bundledPython();
    if (python === undefined)
        return undefined;
    const stamp = `${String(Date.now())}_${String(Math.floor(Math.random() * 1000))}`;
    const src = join(tmpdir(), `qqgm-img-${stamp}.bin`);
    const dst = join(tmpdir(), `qqgm-img-${stamp}.jpg`);
    const script = [
        'import sys, os',
        'from PIL import Image',
        'src, dst, maxside, maxbytes = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])',
        'im = Image.open(src)',
        "if im.mode in ('RGBA', 'LA', 'P'):",
        '    im = im.convert(\'RGBA\')',
        '    bg = Image.new(\'RGB\', im.size, (255, 255, 255))',
        '    bg.paste(im, mask=im.split()[-1])',
        '    im = bg',
        'else:',
        '    im = im.convert(\'RGB\')',
        'im.thumbnail((maxside, maxside))',
        'q = 85',
        'while q >= 45:',
        '    im.save(dst, \'JPEG\', quality=q, optimize=True)',
        '    if os.path.getsize(dst) <= maxbytes: break',
        '    q -= 10',
    ].join('\n');
    try {
        writeFileSync(src, buffer);
        const result = spawnSync(python, ['-c', script, src, dst, String(COMPRESS_MAX_SIDE), String(COMPRESS_TARGET_BYTES)], { timeout: 20000 });
        if (result.status !== 0 || !existsSync(dst))
            return undefined;
        const squeezed = readFileSync(dst);
        if (squeezed.length === 0)
            return undefined;
        logger?.info?.('qq-groupmate: 图片压缩 %s → %s 字节', String(buffer.length), String(squeezed.length));
        return { buffer: squeezed, mime: 'image/jpeg' };
    }
    catch (error) {
        logger?.warn?.('qq-groupmate: 图片压缩失败（继续用原图）：%s', String(error));
        return undefined;
    }
    finally {
        try {
            rmSync(src, { force: true });
            rmSync(dst, { force: true });
        }
        catch {
            // 临时文件删不掉不影响流程
        }
    }
}

/** 从失败信息里认出「不支持哪种图片格式」并记住它。 */
export function noteImageRejection(message, logger) {
    const match = /Unsupported MIME type:\s*([\w/+.-]+)/iu.exec(message);
    if (match === null)
        return;
    const mime = (match[1] ?? '').toLowerCase();
    if (mime === '' || rejectedMimes.has(mime))
        return;
    rejectedMimes.add(mime);
    logger.warn('qq-groupmate: 视觉模型不支持 %s，以后这类图不再带过去', mime);
}
/** 从消息段里挑出图片。 */
export function collectImages(segments) {
    const images = [];
    for (const segment of segments) {
        if (segment.type !== 'image')
            continue;
        const data = segment.data;
        const file = typeof data.file === 'string' ? data.file : undefined;
        const url = typeof data.url === 'string' ? data.url : undefined;
        if (file !== undefined || url !== undefined)
            images.push({ file, url });
    }
    return images;
}
/** 下载一张图（取不到或超限返回 undefined）。 */
export async function downloadImage(client, image, maxBytes, logger) {
    let url = image.url;
    if (url === undefined && image.file !== undefined) {
        try {
            const info = await client.call('get_image', { file: image.file });
            url = typeof info?.url === 'string' && info.url !== '' ? info.url : undefined;
        }
        catch (error) {
            logger.warn('qq-groupmate: get_image 取图失败：%s', String(error));
        }
    }
    if (url === undefined) {
        logger.warn('qq-groupmate: 图片既没有 url 也拿不到地址，跳过这张');
        return undefined;
    }
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) {
            logger.warn('qq-groupmate: 下载图片失败（HTTP %s）', String(response.status));
            return undefined;
        }
        // 先看 content-length，明显超限就别把响应体读进内存。
        const declared = Number(response.headers.get('content-length') ?? '');
        if (Number.isFinite(declared) && declared > maxBytes) {
            logger.warn('qq-groupmate: 图片声明 %s 字节，超过上限 %s，跳过', String(declared), String(maxBytes));
            return undefined;
        }
        // 流式读取并在超限时立刻取消：不信任 content-length（可能缺失或虚报）。
        if (response.body === null) {
            logger.warn('qq-groupmate: 图片响应没有正文，跳过');
            return undefined;
        }
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        let overflow = false;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                received += value.byteLength;
                if (received > maxBytes) {
                    overflow = true;
                    await reader.cancel().catch(() => { });
                    break;
                }
                chunks.push(Buffer.from(value));
            }
        }
        finally {
            reader.releaseLock();
        }
        if (overflow) {
            logger.warn('qq-groupmate: 图片超过上限 %s 字节，已取消下载', String(maxBytes));
            return undefined;
        }
        const buffer = Buffer.concat(chunks);
        const mime = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
        return { buffer, mime: mime.startsWith('image/') ? mime : 'image/jpeg' };
    }
    catch (error) {
        logger.warn('qq-groupmate: 下载图片异常：%s', String(error));
        return undefined;
    }
}
/** 取一批图片（最多 maxImages 张），返回可直接塞进请求的 `data:` URL。 */
export async function fetchImages(client, segments, settings, logger) {
    const images = collectImages(segments).slice(0, Math.max(1, settings.maxImages));
    const result = [];
    for (const image of images) {
        let downloaded = await downloadImage(client, image, settings.maxBytes, logger);
        if (downloaded === undefined)
            continue;
        if (rejectedMimes.has(downloaded.mime.toLowerCase())) {
            logger.info('qq-groupmate: 跳过一张 %s（视觉模型不认这个格式）', downloaded.mime);
            continue;
        }
        // [local patch 2026-10-22] 大图先压缩，避免被模型/请求体上限挡掉
        if (downloaded.buffer.length > COMPRESS_THRESHOLD_BYTES) {
            const squeezed = compressImage(downloaded.buffer, logger);
            if (squeezed !== undefined)
                downloaded = squeezed;
        }
        result.push(`data:${downloaded.mime};base64,${downloaded.buffer.toString('base64')}`);
    }
    return result;
}
