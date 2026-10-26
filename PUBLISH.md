# 上传到 GitHub / Gitee 的三种方式

本仓库是纯文本（约 44 个文件，151 KB），不含任何私人与角色卡数据。

## 方式一：网页上传（不用装任何东西）

1. 打开 GitHub → 右上角 **+ → New repository**
2. 名字随意（例如 `ayu-qq-plugins`），**不要**勾初始化 README
3. 进仓库 → **Add file → Upload files**
4. 把 `ayu-plugins-repo` 里的**所有内容**拖进去（不是拖外层文件夹；也可以直接拖解压后的文件）
5. 写提交信息 → **Commit changes**

> 注意：`.gitignore` 这类点开头的文件在资源管理器里默认隐藏，先开启「显示隐藏的项目」，否则会漏传。

## 方式二：装 Git 后命令行推送

```bash
# 装 Git for Windows 后
cd ayu-plugins-repo
git init
git add -A
git commit -m "feat: Ayu QQ group companion plugin pack"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

如果 GitHub 连不上，可以：

```bash
# 用镜像做 remote（只对 clone/pull 有效，push 仍需直连或代理）
git config --global url."https://gh-proxy.com/https://github.com/".insteadOf "https://github.com/"
```

## 方式三：先传 Gitee，再同步到 GitHub

1. Gitee 新建仓库
2. 同样用「上传文件」把内容拖上去
3. 之后在 GitHub 用「Import a repository」填 Gitee 地址导入

## 上传前自查

```bash
# 确认没有个人信息 / 密钥
grep -rniE "sk-[a-zA-Z0-9]{10,}|C:\\\\Users|/Users/[a-z]|token|secret" . --include="*.js" --include="*.py" --include="*.md"
```

**绝对不要提交**（已在 `.gitignore` 里）：

- `characters/`（角色卡）、`bili-memes.json`（学习产物）
- `affinity.json`、`people/`、`state.json`（群聊与关系数据）
- `ayu-secret.env`、`social.json`、`bili_credential.json`（凭据）
- `*.log`、`edge-profile/`、`node_modules/`、`.venv/`

## 建议的仓库信息

- 描述：`QQ 群 AI 伙伴：好感度 / 记忆 / 识图 / 情绪 / B站学习 / 自主上网（browser-use）+ LUMA 设置页`
- topics：`qqbot` `onebot` `napcat` `deepseek` `dsh` `browser-use` `llm-agent`
- License：MIT（已附 `LICENSE`）
