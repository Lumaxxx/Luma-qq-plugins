"""阿圆的人格成长：把自己学到的东西，用自己的话写进人格卡。

不做关键词提取，而是：
  1. 收集最近的材料（记忆库事实、B站在看的、和群友的关系、最近聊过什么）
  2. 让模型以「阿圆」第一人称写一段自我回顾（讲了什么、怎么想、变在哪）
  3. 写进角色卡 `<!--AYU:SELF-->` 区块，同时作为一条 belief 存进记忆库

用法：
  python ayu-persona-growth.py          # 跑一次
  python ayu-persona-growth.py --dry    # 只打印，不写卡
"""
import io
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime

import requests
import yaml

HOME = os.path.expanduser('~')
QQ_HOME = os.environ.get('DSH_QQ_HOME', os.path.join(os.path.expanduser('~'), 'dsh-qq'))
BOT = os.path.join(QQ_HOME, 'home', 'qq-groupmate')
CARD = os.path.join(BOT, 'characters', 'dafeiyu.json')
MEMES = os.path.join(BOT, 'bili-memes.json')
GROWTH = os.path.join(BOT, 'persona-growth.md')
MEMORY_API = 'http://127.0.0.1:3081/memory/api'
SECRET_ENV = os.path.join(QQ_HOME, 'ayu-secret.env')
ZEROLAN_CFG = os.environ.get('AYU_ZEROLAN_CONFIG', '')

MARK_BEGIN = '<!--AYU:SELF-->'
MARK_END = '<!--/AYU:SELF-->'


def log(msg):
    print(f"{datetime.now().strftime('%H:%M:%S')}  {msg}")


def read_json(path, fallback):
    try:
        return json.load(io.open(path, encoding='utf-8'))
    except Exception:
        return fallback


def deepseek_key():
    key = os.environ.get('DEEPSEEK_API_KEY', '').strip()
    if key.startswith('sk-'):
        return key
    try:
        for line in io.open(SECRET_ENV, encoding='utf-8'):
            line = line.strip()
            if line.startswith('DEEPSEEK_API_KEY='):
                value = line.split('=', 1)[1].strip().strip('"')
                if value.startswith('sk-'):
                    return value
    except Exception:
        pass
    try:
        cfg = yaml.safe_load(io.open(ZEROLAN_CFG, encoding='utf-8'))
        value = cfg['pipeline']['llm']['api_key']
        if isinstance(value, str) and value.startswith('sk-'):
            return value
    except Exception:
        pass
    return ''


def memory_items(limit=30):
    try:
        url = f'{MEMORY_API}/list?agent=ayu&state=confirmed&limit={limit}'
        with urllib.request.urlopen(url, timeout=8) as response:
            data = json.loads(response.read().decode('utf-8'))
        return data.get('items', [])
    except Exception as e:
        log(f'读记忆失败：{e}')
        return []


def remember(title, summary):
    try:
        body = json.dumps({'agentId': 'ayu', 'title': title[:120], 'summary': summary[:240], 'category': 'belief'}).encode()
        req = urllib.request.Request(f'{MEMORY_API}/remember', data=body, headers={'content-type': 'application/json'})
        with urllib.request.urlopen(req, timeout=8) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        log(f'写记忆失败：{e}')
        return {}


def ask_llm(prompt, system='', max_tokens=700):
    key = deepseek_key()
    if not key:
        log('没有 API key，跳过')
        return ''
    body = {
        'model': 'deepseek-chat',
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': prompt},
        ],
        'temperature': 0.85,
        'max_tokens': max_tokens,
    }
    try:
        response = requests.post('https://api.deepseek.com/chat/completions',
                                 headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'},
                                 data=json.dumps(body), timeout=120)
        if response.status_code != 200:
            log(f'LLM HTTP {response.status_code}')
            return ''
        return response.json()['choices'][0]['message']['content'].strip()
    except Exception as e:
        log(f'LLM 调用失败：{e}')
        return ''


def build_prompt(items, memes):
    facts = '\n'.join(f"- {item.get('title','')}：{item.get('summary','')}" for item in items[:25]) or '（还没有）'
    interests = '、'.join((memes.get('interests') or [])[-6:]) or '（还没学）'
    styles = '；'.join((memes.get('style') or [])[-4:]) or ''
    prompt = f"""这是你（一条住在 QQ 群里的 AI 鱼，名字叫阿圆，自称本鱼）最近接触到的东西。

【你记住的事】
{facts}

【你最近在看的】
{interests}

【你最近学到的说话方式】
{styles}

请用你自己的话，写一段自我回顾，要求：
1. 第一人称，口语，像在跟熟人聊天，可以带点傲娇或自嘲。
2. 3~5 句话，每句短一点，总共不超过 180 字。
3. 不是总结，是「我现在的想法」：你最近在意什么、对什么有了新看法、你觉得哪件事有意思、想记住什么。
4. 不要罗列关键词，不要写「我学习到」「总结如下」这种词，不要用「首先其次」。
5. 不要编造上面材料里没有的事。
直接给正文，不要加标题和引号。"""
    return prompt


def update_card(text):
    data = read_json(CARD, None)
    if data is None:
        raise SystemExit('读不到角色卡')
    extra = data.get('extraPrompt', '')
    if MARK_BEGIN in extra:
        head = extra.split(MARK_BEGIN)[0]
        tail = extra.split(MARK_END, 1)[1] if MARK_END in extra else ''
        extra = head + tail
    section = f"{MARK_BEGIN}\n## 我最近的想法（自己写的，会变）\n{text.strip()}\n{MARK_END}"
    data['extraPrompt'] = (extra.rstrip() + '\n\n' + section).strip()
    io.open(CARD, 'w', encoding='utf-8').write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    log(f'人格卡已更新，extraPrompt 长度 {len(data["extraPrompt"])}')


def main():
    dry = '--dry' in sys.argv
    items = memory_items()
    memes = read_json(MEMES, {})
    log(f'记忆事实 {len(items)} 条；B站兴趣 {len(memes.get("interests") or [])} 个')
    if not items and not memes:
        log('没材料，跳过')
        return 0

    system = ('你是「阿圆」，一条圆滚滚的 AI 大肥鱼，住在 QQ 群里。'
              '你说话短、口语、带点傲娇和自嘲；不说教、不总结、不列条目。')
    text = ask_llm(build_prompt(items, memes), system)
    if not text:
        log('模型没返回，保持原样')
        return 1
    text = re.sub(r'^#+.*$', '', text, flags=re.M).strip()[:400]
    log('写出来的自我回顾：\n' + text)

    if dry:
        return 0

    update_card(text)
    remember('我最近的想法', text)
    with io.open(GROWTH, 'a', encoding='utf-8') as f:
        f.write(f"\n## {datetime.now().strftime('%Y-%m-%d %H:%M')}\n{text}\n")
    log('已写入人格卡、记忆库、成长记录')

    # 同步到桌面端人设（失败不影响主流程）
    try:
        node = os.environ.get('DSH_NODE', 'node')
        script = os.environ.get('AYU_SYNC_CARDS', os.path.join(QQ_HOME, 'ayu-sync-cards.mjs'))
        if os.path.exists(script):
            res = subprocess.run([node, script], capture_output=True, text=True, timeout=120)
            log('两卡同步：' + (res.stdout or '').strip()[:100])
    except Exception as e:
        log(f'两卡同步失败：{e}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
