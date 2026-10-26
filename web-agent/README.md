# web-agent（自己上网）

用 [browser-use](https://github.com/browser-use/browser-use) 0.1.40 + 系统 Edge（CDP），
让模型自己开浏览器搜索、点开结果、读页面、回来总结。

## 安装

```powershell
# 1) 建虚拟环境（3.11 最稳）
python -m venv <WEBAGENT_HOME>\.venv
<WEBAGENT_HOME>\.venv\Scripts\python.exe -m pip install -U pip
<WEBAGENT_HOME>\.venv\Scripts\python.exe -m pip install "browser-use==0.1.40" `
    -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com

# 2) 把 run_ayu.py 放到 <WEBAGENT_HOME>\run_ayu.py

# 3) 配 key（二选一）
setx DEEPSEEK_API_KEY sk-xxxx
# 或写本地文件 <QQ_HOME>\ayu-secret.env 里一行 DEEPSEEK_API_KEY=sk-xxxx
```

## 用法

```bat
run_ayu.py search "关键词"          :: 通用搜索
run_ayu.py ask "问题"               :: 自己找可信来源回答
run_ayu.py visit https://a.com "要求" :: 打开指定站点
run_ayu.py explore                  :: 按兴趣自由逛 2-3 个站
run_ayu.py free "任意任务"           :: 一句话任务
run_ayu.py --headless ask "..."     :: 不弹窗口
```

结果同时打印并写入 `last_result.txt`。

## 设计说明

- 用独立 `edge-profile` 起第二个 Edge 实例（端口 9333），**不影响日常使用的 Edge**
- 只在任务结束回调里落盘并退出，避免 browser-use 收尾卡死
- 需要登录/验证码的站点会停在那一页，不会破解

## 已知坑

| 坑 | 解法 |
| --- | --- |
| `connect ECONNREFUSED ::1:9333` | 用 `127.0.0.1`，不要用 `localhost` |
| Edge 起不来 | 不要加 `--remote-debugging-address` |
| emoji 日志导致 UnicodeEncodeError | `PYTHONIOENCODING=utf-8` |
| 任务完成后进程挂住 | 完成回调里 `os._exit(0)` |
| PyPI 下载卡住 | 换阿里云/清华镜像 |
