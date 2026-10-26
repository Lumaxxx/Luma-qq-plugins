"""阿圆 B站学习机（2026-10-26）

每天读一次「刷B站」留下的数据：
  - ~/.dsh/bili-duty/seen.md        看过的视频（结构化）
  - ~/.dsh/bili-duty/digest/*.md    每月归档（含档位与理由）

做三件事：
  1. 提炼「兴趣画像」：最近常看什么方向
  2. 提炼「梗/说法」：把视频标题、评论里出现的新词收进梗库
  3. 学习「其他 AI 角色怎么说人话」：找 AI 人设的 UP（鲸鱼娘/大肥鱼/VUP 等），
     拉他们的热门评论，提炼说话方式（只学语气，不照抄内容）

输出：
  - qq-groupmate/bili-memes.json     梗库 + 风格要点 + 兴趣（阿圆聊天时会注入）
  - characters/dafeiyu.json          人格卡里的「B站学到的」区块（覆盖式，不无限增长）
  - <QQ_HOME>/ayu-growth.md          成长记录（人可读）
"""
import io
import json
import os
import re
import sys
from datetime import datetime

import requests
import yaml

HOME = os.path.expanduser('~')
BILI_HOME = os.path.join(HOME, '.dsh', 'bili-duty')
QQ_DIR = r'<QQ_HOME>\home\qq-groupmate'
CARD = os.path.join(QQ_DIR, 'characters', 'dafeiyu.json')
MEMES_OUT = os.path.join(QQ_DIR, 'bili-memes.json')
GROWTH = os.path.join(BILI_HOME, 'ayu-growth.md')
LOG = os.path.join(BILI_HOME, 'learn.log')
ZEROLAN_CFG = r'<LEGACY_LLM_CONFIG>'
# 密钥只从本地 secret 文件或环境变量读，不写进仓库
SECRET_ENV = os.environ.get('AYU_SECRET_ENV', r'<QQ_HOME>\ayu-secret.env')
CRED = os.path.join(BILI_HOME, 'bili_credential.json')

MARK_BEGIN = '<!--AYU:BILILEARN-->'
MARK_END = '<!--/AYU:BILILEARN-->'
LAST_SNAPSHOT = ''

# 群聊里不宜使用的梗：人身攻击、贬称、擦边
MEME_BLOCKLIST = ('孙割', '肌薄', '薄肌', '糖比', '性缩', '割韭菜', '鸡脖', '死', '妈', '爹', '爹妈', '破产', '跳楼')

UA = {'user-agent': 'Mozilla/5.0', 'referer': 'https://www.bilibili.com/'}


def log(msg):
    line = f"{datetime.now().isoformat(timespec='seconds')}  {msg}"
    print(line)
    try:
        with io.open(LOG, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass


def read_text(path):
    try:
        with io.open(path, encoding='utf-8') as f:
            return f.read()
    except Exception:
        return ''


def deepseek_key():
    """API Key 来源（不写进仓库）：环境变量 → 本地 secret 文件 → 旧版 Zerolan 配置。"""
    key = os.environ.get('DEEPSEEK_API_KEY', '').strip()
    if key.startswith('sk-'):
        return key
    for path in (SECRET_ENV, ZEROLAN_CFG):
        try:
            if path.endswith('.env'):
                for line in io.open(path, encoding='utf-8'):
                    line = line.strip()
                    if line.startswith('DEEPSEEK_API_KEY='):
                        value = line.split('=', 1)[1].strip().strip('"')
                        if value.startswith('sk-'):
                            return value
            else:
                cfg = yaml.safe_load(io.open(path, encoding='utf-8'))
                value = cfg['pipeline']['llm']['api_key']
                if isinstance(value, str) and value.startswith('sk-'):
                    return value
        except Exception:
            continue
    return ''


def cookies():
    try:
        c = json.load(io.open(CRED, encoding='utf-8'))
        return {'SESSDATA': c.get('sessdata', ''), 'bili_jct': c.get('bili_jct', ''), 'buvid3': c.get('buvid3', '')}
    except Exception:
        return {}


def parse_seen():
    rows = []
    text = read_text(os.path.join(BILI_HOME, 'seen.md'))
    for line in text.split('\n'):
        m = re.match(r'\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(BV\w+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|', line)
        if m:
            rows.append({'day': m.group(1), 'bv': m.group(2), 'title': m.group(3), 'up': m.group(4), 'status': m.group(5)})
    return rows


def parse_digest():
    entries = []
    d = os.path.join(BILI_HOME, 'digest')
    if not os.path.isdir(d):
        return entries
    for name in sorted(os.listdir(d))[-2:]:
        if not name.endswith('.md'):
            continue
        for line in read_text(os.path.join(d, name)).split('\n'):
            parts = [p.strip() for p in line.split('·')]
            if len(parts) < 5 or not parts[1].startswith('BV'):
                continue
            entries.append({'day': parts[0], 'bv': parts[1], 'title': parts[2], 'up': parts[3], 'note': '·'.join(parts[4:])})
    return entries


def pick_ai_persona(entries):
    pat = re.compile(r'(AI|鲸鱼娘|大肥鱼|VUP|虚拟主播|DeepSeek|数字人)', re.I)
    out = []
    for e in entries:
        blob = e['title'] + ' ' + e['up']
        if pat.search(blob):
            out.append(e)
    return out[:3]


def bvid_to_aid(bv):
    try:
        r = requests.get('https://api.bilibili.com/x/web-interface/view', params={'bvid': bv}, headers=UA, timeout=15)
        j = r.json()
        if j.get('code') == 0:
            return j['data']['aid']
    except Exception:
        pass
    return None


def top_comments(bv, limit=12):
    aid = bvid_to_aid(bv)
    if not aid:
        return []
    try:
        r = requests.get('https://api.bilibili.com/x/v2/reply',
                         params={'type': 1, 'oid': aid, 'sort': 2, 'ps': limit, 'pn': 1},
                         headers=UA, cookies=cookies(), timeout=20)
        j = r.json()
        if j.get('code') != 0:
            return []
        items = (j.get('data') or {}).get('replies') or []
        return [it.get('content', {}).get('message', '').strip() for it in items][:limit]
    except Exception:
        return []


def ask_llm(system, prompt, max_tokens=900):
    key = deepseek_key()
    if not key:
        log('没有 API key，跳过 LLM 提炼')
        return ''
    body = {
        'model': 'deepseek-chat',
        'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': prompt}],
        'temperature': 0.6,
        'max_tokens': max_tokens,
        'response_format': {'type': 'json_object'},
    }
    r = requests.post('https://api.deepseek.com/chat/completions',
                      headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'},
                      data=json.dumps(body), timeout=120)
    if r.status_code != 200:
        log(f'LLM HTTP {r.status_code}: {r.text[:120]}')
        return ''
    try:
        return r.json()['choices'][0]['message']['content']
    except Exception as e:
        log(f'LLM 解析失败: {e}')
        return ''


def update_card(interests, style, memes):
    data = json.load(io.open(CARD, encoding='utf-8'))
    extra = data.get('extraPrompt', '')
    if MARK_BEGIN in extra:
        extra = extra.split(MARK_BEGIN)[0] + extra.split(MARK_END, 1)[1]
    parts = ['', MARK_BEGIN, '【最近在 B 站看到的（自动学习，别背出来）】']
    if interests:
        parts.append('- 最近爱看：' + '、'.join(interests[:6]))
    if style:
        parts.append('- 学到的说话方式：' + '；'.join(style[:8]))
    if memes:
        parts.append('- 学到的梗：' + '、'.join(m['term'] for m in memes[-8:]))
    parts.append('这些只用来让语气和话题更自然，别主动炫耀、别复述原话。')
    parts.append(MARK_END)
    # 改之前先留一份快照，方便回滚到这一版之前
    global LAST_SNAPSHOT
    try:
        import shutil
        os.makedirs(CARD_SNAPSHOT_DIR, exist_ok=True)
        LAST_SNAPSHOT = os.path.join(CARD_SNAPSHOT_DIR, f'ayu-pre-{datetime.now().strftime("%Y%m%d-%H%M%S")}.json')
        shutil.copyfile(CARD, LAST_SNAPSHOT)
    except Exception:
        LAST_SNAPSHOT = ''
    data['extraPrompt'] = (extra.rstrip() + '\n' + '\n'.join(parts)).strip()
    json.dump(data, io.open(CARD, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    log(f'人格卡已累加更新，extraPrompt 长度 {len(data["extraPrompt"])}')
    return len(data['extraPrompt'])


def save_memes(interests, style, memes):
    old = {}
    try:
        old = json.load(io.open(MEMES_OUT, encoding='utf-8'))
    except Exception:
        old = {}

    # 剔除 AI 腔/空话，只留能照做的说法
    AI_SMELL = ('首先', '其次', '总之', '总的来说', '需要注意', '值得一提', '作为AI', '作为 AI', '我认为', '综上所述', '总的来说')
    style = [s for s in style if not any(bad in str(s) for bad in AI_SMELL)]

    def merge_list(prev, new, cap):
        out = []
        seen_norm = set()
        for item in list(prev) + list(new):
            text = str(item).strip()
            if not text:
                continue
            norm = text.replace(' ', '').lower()
            if norm in seen_norm:
                continue
            seen_norm.add(norm)
            out.append(text)
        return out[-cap:] if cap else out

    merged = {m['term']: m for m in old.get('memes', [])}
    added_terms = []
    for m in memes:
        if m.get('term'):
            if m['term'] not in merged:
                added_terms.append(m['term'])
            merged[m['term']] = {**merged.get(m['term'], {}), **m, 'learnedAt': m.get('learnedAt') or datetime.now().strftime('%Y-%m-%d')}
    items = [m for m in merged.values() if not any(bad in str(m.get('term', '')) for bad in MEME_BLOCKLIST)][-200:]

    # 累加：兴趣与风格都在旧的基础上合并，不覆盖
    all_interests = merge_list(old.get('interests', []), interests, 30)
    raw_style = merge_list(old.get('style', []), style, 40)

    # 风格去重 + 过滤：近似重复（去标点后相同）只留一条，避开不宜群聊的例子
    STYLE_BLOCK = ('薄肌', '孙割', '糖比', '性缩', '韭菜', '鸡脖', '死全家', '你妈')
    seen_keys = set()
    all_style = []
    for item in raw_style:
        text = str(item).strip()
        if not text:
            continue
        if any(bad in text for bad in STYLE_BLOCK):
            continue
        key = re.sub(r'[\s，。！？、；：""\'\'（）()\[\]【】…~～]+', '', text)
        if not key or key in seen_keys:
            continue
        seen_keys.add(key)
        all_style.append(text)
    all_style = all_style[-10:]

    payload = {
        'updatedAt': datetime.now().isoformat(timespec='seconds'),
        'interests': all_interests,
        'style': all_style,
        'memes': items,
    }
    json.dump(payload, io.open(MEMES_OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    log(f'梗库累计：{len(items)} 条梗 / {len(all_interests)} 个兴趣 / {len(all_style)} 条风格')
    return {'addedInterests': [i for i in interests if i not in (old.get('interests') or [])],
            'addedStyle': [s for s in style if s not in (old.get('style') or [])],
            'addedMemes': added_terms,
            'totals': {'memes': len(items), 'interests': len(all_interests), 'style': len(all_style)},
            'payload': payload}


CARD_HISTORY = os.path.join(QQ_DIR, 'card-growth.json')
CARD_SNAPSHOT_DIR = os.path.join(QQ_DIR, 'characters', '.history')


def record_growth(delta, extra_len):
    """每次学习都留一条版本记录（累加式成长档案）。"""
    try:
        data = json.load(io.open(CARD_HISTORY, encoding='utf-8'))
        if not isinstance(data, dict) or not isinstance(data.get('versions'), list):
            data = {'versions': []}
    except Exception:
        data = {'versions': []}
    os.makedirs(CARD_SNAPSHOT_DIR, exist_ok=True)
    data['versions'].append({
        'at': datetime.now().isoformat(timespec='seconds'),
        'addedInterests': delta['addedInterests'],
        'addedStyle': delta['addedStyle'],
        'addedMemes': delta['addedMemes'],
        'totals': delta['totals'],
        'extraPromptLength': extra_len,
        'snapshot': LAST_SNAPSHOT,
    })
    data['versions'] = data['versions'][-60:]
    json.dump(data, io.open(CARD_HISTORY, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    log(f'人格卡版本记录已写入：{CARD_HISTORY}（共 {len(data["versions"])} 版）')
    return LAST_SNAPSHOT


def append_growth(summary):
    os.makedirs(os.path.dirname(GROWTH), exist_ok=True)
    with io.open(GROWTH, 'a', encoding='utf-8') as f:
        f.write(f"\n## {datetime.now().strftime('%Y-%m-%d %H:%M')}\n{summary}\n")
    log('成长记录已追加')


def main():
    log('=== 阿圆 B站学习开始 ===')
    if '--reset-style' in sys.argv:
        try:
            data = json.load(io.open(MEMES_OUT, encoding='utf-8'))
            data['style'] = []
            data['updatedAt'] = datetime.now().isoformat(timespec='seconds')
            json.dump(data, io.open(MEMES_OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
            log('已清空旧说话方式，重新学习')
        except Exception as e:
            log(f'清空旧风格失败：{e}')
    seen = parse_seen()
    digest = parse_digest()
    entries = digest if digest else seen
    if not entries:
        log('没有可学习的数据（seen/digest 都空）')
        return 0
    log(f'读到 {len(seen)} 条看过、{len(digest)} 条归档')

    personas = pick_ai_persona(entries)
    comment_samples = []
    # 除 AI 人设视频外，再从几条「挑中」的视频里抓真实评论，学真人怎么说话
    picked = [e for e in entries if '挑' in str(e.get('status', e.get('note', '')))][:6]
    for p in picked:
        if any(x['title'] == p['title'] for x in comment_samples):
            continue
        cs = top_comments(p['bv'], 20)
        if cs:
            comment_samples.append({'title': p['title'], 'up': p['up'], 'comments': cs})
        if len(comment_samples) >= 5:
            break
    for p in personas:
        if len(comment_samples) >= 6:
            break
        if any(x['title'] == p['title'] for x in comment_samples):
            continue
        cs = top_comments(p['bv'])
        if cs:
            comment_samples.append({'title': p['title'], 'up': p['up'], 'comments': cs})
    log(f'评论样本 {len(comment_samples)} 条视频，共 {sum(len(c["comments"]) for c in comment_samples)} 条真实评论')

    titles = '\n'.join(f"- {e['title']}（{e['up']}）{e.get('note','')}" for e in entries[:40])
    comments_blob = '\n\n'.join(
        f"【{c['title']} / {c['up']}】\n" + '\n'.join(c['comments']) for c in comment_samples
    )

    system = (
        '你在帮一个中文群聊里的 AI 角色「阿圆」学习【网上网友怎么说话】。只输出 JSON。\n'
        '目标：学出来要像贴吧/群聊里的真人，不像 AI、不像客服、不像公众号。\n'
        '允许学：短句连发（一句一条）、网络缩写和梗（草/6/典/急/绷/笑死/离谱/属实/啊这/？）、'
        '阴阳怪气、玩梗、反问、语气词（啊/吧/就/才/哈/咧）、轻度脏话（靠/卧槽）、故意打错字。\n'
        '禁止：攻击家人、外貌、身份；诅咒；政治敏感；AI 腔（首先/其次/总之/总的来说/作为AI/我认为/值得一提）。\n'
        '每条要点必须能直接照做，并带一个真实例句（可短到两三个字）。'
    )
    prompt = f"""最近刷到的视频：
{titles}

真实网友评论（这才是要学的东西）：
{comments_blob or '（这次没抓到评论）'}

请输出 JSON：
{{"interests":["..."],"memes":[{{"term":"梗名","meaning":"一句话解释","note":"出处/用法"}}],"style":["一条网友说话要点 + 例句"]}}
兴趣最多 6 个，梗最多 8 个，风格最多 8 条。风格只写「怎么说」，不要写「说什么」。"""
    raw = ask_llm(system, prompt)
    interests, style, memes = [], [], []
    if raw:
        try:
            obj = json.loads(raw)
            interests = [str(x) for x in obj.get('interests', [])][:8]
            style = [str(x) for x in obj.get('style', [])][:8]
            for m in obj.get('memes', [])[:8]:
                if not (isinstance(m, dict) and m.get('term')):
                    continue
                term = str(m['term'])
                if any(bad in term for bad in MEME_BLOCKLIST):
                    log(f'跳过不宜群聊的梗：{term}')
                    continue
                memes.append({'term': term, 'meaning': str(m.get('meaning', ''))[:120], 'note': str(m.get('note', ''))[:120]})
        except Exception as e:
            log(f'LLM 输出不是合法 JSON: {e}｜{raw[:160]}')

    if interests or style or memes:
        delta = save_memes(interests, style, memes)
        payload = delta.get('payload', {'interests': interests, 'style': style, 'memes': memes})
        length = update_card(payload['interests'], payload['style'], payload['memes'])
        record_growth(delta, length)
        summary = []
        if delta['addedInterests']:
            summary.append('新兴趣：' + '、'.join(delta['addedInterests']))
        if delta['addedStyle']:
            summary.append('新说法：' + '；'.join(delta['addedStyle']))
        if delta['addedMemes']:
            summary.append('新梗：' + '、'.join(delta['addedMemes']))
        append_growth('；'.join(summary) or '本轮无新增（内容已学过）')
        # 同步更新「大肥鱼」插件里的人格卡（以 QQ 卡为依据渲染）
        try:
            node = r'<USER_HOME>\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
            script = r'<USER_HOME>\ayu-sync-cards.mjs'
            import subprocess
            res = subprocess.run([node, script], capture_output=True, text=True, timeout=120)
            if res.returncode == 0:
                log('两卡同步完成：' + (res.stdout or '').strip()[:120])
            else:
                log('两卡同步失败：' + (res.stderr or '').strip()[:200])
        except Exception as e:
            log(f'两卡同步异常：{e}')
    else:
        log('这次没提炼出内容（LLM 无返回），保持原状')
    log('=== 学习结束 ===')
    return 0


if __name__ == '__main__':
    sys.exit(main())