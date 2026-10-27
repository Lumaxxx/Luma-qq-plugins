/**
 * dsh-qq-social 浏览器半：设置 → LUMA（独立分栏，跟「表情包 / IM 机器人」同级）
 */
window.__ModuleLoader__.load({
	id: "dsh-qq-social",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;

		const API = "/dsh-qq-social-api";

		const ROWS = [
			["affinityEnabled", "好感度与关系", "记录跟每个人的好感度（按 QQ 号认人，跨群/私聊通用）"],
			["slangEnabled", "群黑话", "只收群友自己给过定义的说法（「X 就是 Y」）"],
			["personaEvolutionEnabled", "人格演化", "随互动演化语气与偏好，保留 5 代快照"],
			["cardEvolutionEnabled", "写回角色卡", "把学到的口头禅与关系写进角色卡的说话风格/性格（自动备份）"],
		];

		const rowStyle = {
			display: "flex",
			alignItems: "flex-start",
			justifyContent: "space-between",
			gap: "16px",
			padding: "12px 0",
			borderBottom: "1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.16))",
		};
		const labelStyle = { fontSize: 13, lineHeight: 1.5, color: "var(--dsw-alias-label-primary)" };
		const hintStyle = { fontSize: 12, lineHeight: 1.5, marginTop: 2, color: "var(--dsw-alias-label-secondary)" };
		const inputStyle = {
			width: 88,
			height: 30,
			padding: "0 8px",
			boxSizing: "border-box",
			borderRadius: 6,
			border: "1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.3))",
			background: "var(--dsw-alias-surface-secondary, transparent)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 13,
		};

		function Section() {
			const [config, setConfig] = React.useState(null);
			const [tab, setTab] = React.useState("basic");
			const [status, setStatus] = React.useState("正在读取…");
			const [busy, setBusy] = React.useState(false);

			React.useEffect(() => {
				let alive = true;
				fetch(API)
					.then((response) => response.json())
					.then((data) => {
						if (!alive) return;
						if (data && data.ok === true && data.config) {
							setConfig(data.config);
							setStatus("改动保存后会自动重启 QQ 桥并生效");
						}
						else {
							setStatus("读取失败：" + String((data && data.error) || "未知错误"));
						}
					})
					.catch((error) => {
						if (alive) setStatus("读取失败：" + String(error && error.message ? error.message : error));
					});
				return () => { alive = false; };
			}, []);

			const patch = (key, value) => setConfig((prev) => Object.assign({}, prev, { [key]: value }));

			const [affinity, setAffinity] = React.useState(null);
			const loadAffinity = () => {
				const apply = (data) => {
					if (data && Array.isArray(data.people)) setAffinity(data);
					else setAffinity({ people: [], groups: [] });
				};
				fetch(API + "?view=affinity")
					.then((response) => response.json())
					.then((data) => {
						// 桌面端插件主机还没重启时这个接口还是旧版，退回只读小服务
						if (data && Array.isArray(data.people)) return apply(data);
						return fetch("http://127.0.0.1:3082/affinity")
							.then((response) => response.json())
							.then(apply)
							.catch(() => apply(null));
					})
					.catch(() => {
						fetch("http://127.0.0.1:3082/affinity")
							.then((response) => response.json())
							.then(apply)
							.catch(() => apply(null));
					});
			};
			React.useEffect(() => { loadAffinity(); }, []);

			// ── 刷B站快捷模式 ───────────────────────────────────────
			const [bili, setBili] = React.useState(null);
			const [biliStatus, setBiliStatus] = React.useState("");
			const loadBili = () => {
				fetch(API + "?view=bili")
					.then((response) => response.json())
					.then((data) => setBili(data && data.bili ? data.bili : null))
					.catch(() => setBili(null));
			};
			React.useEffect(() => { loadBili(); }, []);

			// ── 梗库（B站学到的）─────────────────────────────────────
			const [memes, setMemes] = React.useState(null);
			const [memesStatus, setMemesStatus] = React.useState("");
			const loadMemes = () => {
				fetch(API + "?view=memes")
					.then((response) => response.json())
					.then((data) => setMemes(data && data.ok === true ? data : null))
					.catch(() => setMemes(null));
			};
			React.useEffect(() => { loadMemes(); }, []);

			// ── 人格卡学习记录 ───────────────────────────────────────
			const [growth, setGrowth] = React.useState(null);
			const loadGrowth = () => {
				const apply = (data) => setGrowth(data && Array.isArray(data.versions) ? data : { versions: [] });
				fetch(API + "?view=growth")
					.then((response) => response.json())
					.then((data) => {
						if (data && Array.isArray(data.versions)) return apply(data);
						return fetch("http://127.0.0.1:3082/growth")
							.then((response) => response.json())
							.then(apply)
							.catch(() => apply(null));
					})
					.catch(() => {
						fetch("http://127.0.0.1:3082/growth")
							.then((response) => response.json())
							.then(apply)
							.catch(() => apply(null));
					});
			};
			React.useEffect(() => { loadGrowth(); }, []);

			// ── 两张人格卡同步 ───────────────────────────────────────
			const CARDS_API = "http://127.0.0.1:3082";
			const [cards, setCards] = React.useState(null);
			const [cardsStatus, setCardsStatus] = React.useState("");
			const loadCards = () => {
				fetch(CARDS_API + "/cards")
					.then((response) => response.json())
					.then((data) => setCards(data && data.ok === true ? data : null))
					.catch(() => setCards(null));
			};
			React.useEffect(() => { loadCards(); }, []);
			const syncCards = () => {
				setCardsStatus("正在同步…");
				fetch(CARDS_API + "/sync", { method: "POST" })
					.then((response) => response.json())
					.then((data) => {
						setCardsStatus(data && data.ok === true ? "已触发同步，约 10 秒后刷新" : ("同步失败：" + String((data && data.error) || "")));
					})
					.catch((error) => setCardsStatus("同步失败：" + String(error && error.message ? error.message : error)));
			};
			const deleteMeme = (term) => {
				fetch(API, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ memes: { action: "delete", term } }),
				})
					.then((response) => response.json())
					.then((data) => {
						if (data && data.ok === true) setMemes(data);
						setMemesStatus("已删除：" + term);
					})
					.catch((error) => setMemesStatus("删除失败：" + String(error && error.message ? error.message : error)));
			};
			const relearnMemes = () => {
				setMemesStatus("已触发重新学习，约 1 分钟后刷新看看");
				fetch(API, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ memes: { action: "relearn" } }),
				}).catch(() => setMemesStatus("触发失败"));
			};
			const patchBili = (key, value) => setBili((prev) => Object.assign({}, prev, { [key]: value }));
			const saveBili = () => {
				if (bili === null) return;
				setBiliStatus("保存中…");
				fetch(API, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ bili }),
				})
					.then((response) => response.json())
					.then((data) => {
						if (data && data.bili) setBili(data.bili);
						setBiliStatus(data && data.ok === true ? "已保存（下一轮生效）" : ("保存失败：" + String((data && data.error) || "")));
					})
					.catch((error) => setBiliStatus("保存失败：" + String(error && error.message ? error.message : error)));
			};

			/** 好感度表格（表格内容用普通变量拼，避免嵌套括号写错）。 */
			const affinityTable = () => {
				const thStyle = { textAlign: "left", padding: "6px 8px", fontWeight: 500, borderBottom: "1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.16))" };
				const tdStyle = { padding: "6px 8px" };
				const secondary = { color: "var(--dsw-alias-label-secondary)" };
				const head = h("tr", null, ["昵称", "QQ", "好感", "档位", "消息", "会话", "最后互动"].map(label =>
					h("th", { key: label, style: Object.assign({}, thStyle, secondary) }, label)));
				const body = affinity.people.map(person => h("tr", { key: person.qq },
					h("td", { style: Object.assign({}, tdStyle, { color: "var(--dsw-alias-label-primary)" }) }, person.name || "（未知）"),
					h("td", { style: Object.assign({}, tdStyle, secondary) }, person.qq),
					h("td", { style: Object.assign({}, tdStyle, { fontWeight: 600, color: "var(--dsw-alias-label-primary)" }) }, String(person.score)),
					h("td", { style: Object.assign({}, tdStyle, secondary) }, person.tier),
					h("td", { style: Object.assign({}, tdStyle, secondary) }, String(person.msgs)),
					h("td", { style: Object.assign({}, tdStyle, secondary) }, String(person.chats)),
					h("td", { style: Object.assign({}, tdStyle, secondary) }, person.lastAt ? new Date(person.lastAt).toLocaleString("zh-CN") : "-"),
				));
				return h("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 } },
					h("thead", null, head),
					h("tbody", null, body));
			};

			const save = () => {
				if (config === null) return;
				setBusy(true);
				setStatus("正在保存…");
				fetch(API, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ config, restart: true }),
				})
					.then((response) => response.json())
					.then((data) => {
						setBusy(false);
						setStatus(data && data.ok === true
							? "已保存，QQ 桥正在重启（约 15 秒后连上）"
							: "保存失败：" + String((data && data.error) || "未知错误"));
					})
					.catch((error) => {
						setBusy(false);
						setStatus("保存失败：" + String(error && error.message ? error.message : error));
					});
			};

			if (config === null) {
				return h("div", { style: { padding: "18px", fontSize: 13, color: "var(--dsw-alias-label-secondary)" } }, status);
			}

			return h("div", { style: { display: "flex", flexDirection: "column", gap: 4, padding: "4px 2px" } },
				h("div", { style: { fontSize: 15, fontWeight: 600, color: "var(--dsw-alias-label-primary)", marginBottom: 4 } }, "LUMA（QQ 群大肥鱼）"),
				h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", marginBottom: 8 } },
					"这里调的是 QQ 群里那只大肥鱼；配置保存在 DSH_QQ_HOME/social.json"),

				// ── 分类导航 ─────────────────────────────────────────
				h("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0 10px" } },
					...[
						["basic", "基础与人格"],
						["vision", "识图"],
						["memory", "记忆"],
						["language", "语言卫生"],
						["data", "上网与数据"],
					].map(([key, label]) => h("button", {
						key,
						type: "button",
						onClick: () => setTab(key),
						style: {
							height: 28, padding: "0 12px", borderRadius: 999, cursor: "pointer", fontSize: 12,
							border: "1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.3))",
							background: tab === key ? "var(--dsw-alias-interactive-bg-accent, #3b82f6)" : "transparent",
							color: tab === key ? "#fff" : "var(--dsw-alias-label-primary)",
						},
					}, label)),
				),

				...(tab === "basic" ? [
				...ROWS.map(([key, label, hint]) => h("div", { key, style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, label),
						h("div", { style: hintStyle }, hint),
					),
					h("input", {
						type: "checkbox",
						checked: config[key] !== false,
						onChange: (event) => patch(key, event.target.checked),
						style: { width: 18, height: 18, marginTop: 2 },
					}),
				)),
				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "对话窗口（分钟）"),
						h("div", { style: hintStyle }, "关键词唤醒后，这段时间内不用再打关键词"),
					),
					h("input", {
						type: "number", min: 0, max: 120, value: config.triggerWindowMinutes,
						onChange: (event) => patch("triggerWindowMinutes", Number(event.target.value)),
						style: inputStyle,
					}),
				),
				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "演化刷新（条）"),
						h("div", { style: hintStyle }, "攒够这么多条新消息重新评估一次人格"),
					),
					h("input", {
						type: "number", min: 20, max: 2000, step: 10, value: config.evolutionRefreshEvery,
						onChange: (event) => patch("evolutionRefreshEvery", Number(event.target.value)),
						style: inputStyle,
					}),
				),
				h("div", { style: { display: "flex", flexDirection: "column", gap: 6, padding: "12px 0" } },
					h("div", { style: labelStyle }, "手动人格补充"),
					h("div", { style: hintStyle }, "写在这里的话会拼在人设提示最后，优先于自动学习；留空表示不加"),
					h("textarea", {
						value: config.personaNote,
						onChange: (event) => patch("personaNote", event.target.value),
						rows: 4,
						style: Object.assign({}, inputStyle, { width: "100%", height: "auto", padding: "8px 10px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }),
					}),
				),
				// ── 情绪与守卫（2026-10-25 新增）─────────────────────────
				h("div", { style: { fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary)", paddingTop: 10 } }, "情绪与守卫"),
				...[
					["moodEnabled", "情绪系统", "被夸/被怼/被刁难时改变语气，会按时过期（只影响语气，不改人设）"],
					["guardMuteCheck", "禁言检测", "自己被禁言时不生成回复，省 token"],
				].map(([key, label, hint]) => h("div", { key, style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, label),
						h("div", { style: hintStyle }, hint),
					),
					h("input", {
						type: "checkbox",
						checked: config[key] !== false,
						onChange: (event) => patch(key, event.target.checked),
						style: { width: 18, height: 18, marginTop: 2 },
					}),
				)),
				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "情绪持续（小时）"),
						h("div", { style: hintStyle }, "多久自动消失，1~72 小时"),
					),
					h("input", {
						type: "number", min: 1, max: 72, value: config.moodDurationHours ?? 4,
						onChange: (event) => patch("moodDurationHours", Number(event.target.value)),
						style: inputStyle,
					}),
				),
				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "每分钟回复上限"),
						h("div", { style: hintStyle }, "每个群每分钟最多回几条，0 = 不限"),
					),
					h("input", {
						type: "number", min: 0, max: 60, value: config.guardMaxRepliesPerMinute ?? 4,
						onChange: (event) => patch("guardMaxRepliesPerMinute", Number(event.target.value)),
						style: inputStyle,
					}),
				),
				] : []),

				...(tab === "vision" ? [
				// ── 识图（2026-10-25 新增）─────────────────────────────
				h("div", { style: { fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary)", paddingTop: 10 } }, "识图"),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "识图开关"),
						h("div", { style: hintStyle }, "群里发图时直接看图；关掉就只当没看见"),
					),
					h("input", {
						type: "checkbox",
						checked: config.visionEnabled !== false,
						onChange: (event) => patch("visionEnabled", event.target.checked),
						style: { width: 18, height: 18, marginTop: 2 },
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "识图模型"),
						h("div", { style: hintStyle }, "模型配置名，默认 vision-api（DeepSeek 平台 API 的 deepseek-flash）"),
					),
					h("input", {
						type: "text",
						value: config.visionModel ?? "vision-api",
						onChange: (event) => patch("visionModel", event.target.value),
						style: Object.assign({}, inputStyle, { width: 140 }),
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "每次最多几张"),
						h("div", { style: hintStyle }, "一条消息里最多看几张图，1~10"),
					),
					h("input", {
						type: "number", min: 1, max: 10, value: config.visionMaxImages ?? 3,
						onChange: (event) => patch("visionMaxImages", Number(event.target.value)),
						style: inputStyle,
					}),
				),
				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "识图缓存"),
						h("div", { style: hintStyle }, "同一张图只识一次，之后直接引用上次的描述（省调用）"),
					),
					h("input", {
						type: "checkbox",
						checked: config.mediaCache !== false,
						onChange: (event) => patch("mediaCache", event.target.checked),
						style: { width: 18, height: 18, marginTop: 2 },
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "本地 OCR"),
						h("div", { style: hintStyle }, "先用本机 Umi-OCR 把图里的字读出来（图片不出本机）"),
					),
					h("input", {
						type: "checkbox",
						checked: config.mediaOcr !== false,
						onChange: (event) => patch("mediaOcr", event.target.checked),
						style: { width: 18, height: 18, marginTop: 2 },
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "OCR 地址"),
						h("div", { style: hintStyle }, "Umi-OCR 的 HTTP 接口，默认 http://127.0.0.1:1224"),
					),
					h("input", {
						type: "text",
						value: config.mediaOcrUrl ?? "http://127.0.0.1:1224",
						onChange: (event) => patch("mediaOcrUrl", event.target.value),
						style: Object.assign({}, inputStyle, { width: 210 }),
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "多图拼图"),
						h("div", { style: hintStyle }, "一条消息 2~3 张图拼成一张再识，省一次调用"),
					),
					h("input", {
						type: "checkbox",
						checked: config.mediaGrid !== false,
						onChange: (event) => patch("mediaGrid", event.target.checked),
						style: { width: 18, height: 18, marginTop: 2 },
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "表情包匹配"),
						h("div", { style: hintStyle }, "本地表情库按指纹匹配，命中就不调视觉模型"),
					),
					h("input", {
						type: "checkbox",
						checked: config.mediaStickerMatch !== false,
						onChange: (event) => patch("mediaStickerMatch", event.target.checked),
						style: { width: 18, height: 18, marginTop: 2 },
					}),
				),
				] : []),

				...(tab === "memory" ? [
				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "长期记忆召回"),
						h("div", { style: hintStyle }, "被问到「还记得/刚才/别的群」时，从记忆库翻旧事"),
					),
					h("input", {
						type: "checkbox",
						checked: config.memoryRecallEnabled !== false,
						onChange: (event) => patch("memoryRecallEnabled", event.target.checked),
						style: { width: 18, height: 18, marginTop: 2 },
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "同一件事冷却（小时）"),
						h("div", { style: hintStyle }, "一条记忆用过之后多久内不再重复提起，1~72"),
					),
					h("input", {
						type: "number", min: 1, max: 72, value: config.memoryFactCooldownHours ?? 3,
						onChange: (event) => patch("memoryFactCooldownHours", Number(event.target.value)),
						style: inputStyle,
					}),
				),
				] : []),

				...(tab === "language" ? [
				// ── 语言卫生（2026-10-28 新增）──────────────────────────
				h("div", { style: { fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary)", paddingTop: 4 } }, "语言卫生（防复读 / 词句权重）"),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "刷屏节流"),
						h("div", { style: hintStyle }, "对方连续发相似短句时直接不接话"),
					),
					h("input", {
						type: "checkbox",
						checked: config.languageThrottle !== false,
						onChange: (event) => patch("languageThrottle", event.target.checked),
						style: { width: 18, height: 18, marginTop: 2 },
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "防复读（字面判重）"),
						h("div", { style: hintStyle }, "剪掉和最近几句重复的话；全重复就不接话"),
					),
					h("input", {
						type: "checkbox",
						checked: config.mediaAntiRepeat !== false,
						onChange: (event) => patch("mediaAntiRepeat", event.target.checked),
						style: { width: 18, height: 18, marginTop: 2 },
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "词句硬删除"),
						h("div", { style: hintStyle }, "反复出现的词句直接从输出里删掉（不靠提示词）"),
					),
					h("input", {
						type: "checkbox",
						checked: config.languageWordClip !== false,
						onChange: (event) => patch("languageWordClip", event.target.checked),
						style: { width: 18, height: 18, marginTop: 2 },
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "恢复阈值（倍）"),
						h("div", { style: hintStyle }, "某词出现次数降到其它词最高值的多少倍就恢复输出，1~3"),
					),
					h("input", {
						type: "number", min: 1, max: 3, step: 0.1, value: config.languageClipRatio ?? 1.3,
						onChange: (event) => patch("languageClipRatio", Number(event.target.value)),
						style: inputStyle,
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "语义自检"),
						h("div", { style: hintStyle }, "字面不一样但意思重复时，让模型判一次 YES/NO（每轮多一次小调用）"),
					),
					h("input", {
						type: "checkbox",
						checked: config.languageSemanticCheck !== false,
						onChange: (event) => patch("languageSemanticCheck", event.target.checked),
						style: { width: 18, height: 18, marginTop: 2 },
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "自检触发相似度"),
						h("div", { style: hintStyle }, "字面相似度超过这个值才做语义自检，0~1（越大越省）"),
					),
					h("input", {
						type: "number", min: 0, max: 1, step: 0.01, value: config.languageSemanticThreshold ?? 0.22,
						onChange: (event) => patch("languageSemanticThreshold", Number(event.target.value)),
						style: inputStyle,
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "频率惩罚"),
						h("div", { style: hintStyle }, "解码层压低已出现词的概率，0~2（建议 0.3~0.8）"),
					),
					h("input", {
						type: "number", min: 0, max: 2, step: 0.1, value: config.languageFrequencyPenalty ?? 0.5,
						onChange: (event) => patch("languageFrequencyPenalty", Number(event.target.value)),
						style: inputStyle,
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "存在惩罚"),
						h("div", { style: hintStyle }, "只要说过就压一次，鼓励换话题，0~2（建议 0.1~0.4）"),
					),
					h("input", {
						type: "number", min: 0, max: 2, step: 0.1, value: config.languagePresencePenalty ?? 0.2,
						onChange: (event) => patch("languagePresencePenalty", Number(event.target.value)),
						style: inputStyle,
					}),
				),

				] : []),

				...(tab === "data" ? [
				// ── 上网（browser-use，2026-10-26 新增）─────────────────
				h("div", { style: { fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary)", paddingTop: 14 } }, "上网（自己开浏览器查资料）"),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "上网开关"),
						h("div", { style: hintStyle }, "群里说「阿圆查一下 XXX」时，开浏览器去查；关掉就只聊天"),
					),
					h("input", {
						type: "checkbox",
						checked: config.webEnabled !== false,
						onChange: (event) => patch("webEnabled", event.target.checked),
						style: { width: 18, height: 18, marginTop: 2 },
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "显示浏览器窗口"),
						h("div", { style: hintStyle }, "开：另开一个 Edge 窗口让你看着它操作；关：后台隐身（你的 Edge 不受影响）"),
					),
					h("input", {
						type: "checkbox",
						checked: config.webVisible !== false,
						onChange: (event) => patch("webVisible", event.target.checked),
						style: { width: 18, height: 18, marginTop: 2 },
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "最多几步"),
						h("div", { style: hintStyle }, "一次查询最多操作多少步，1~30；越大越耐心也越慢"),
					),
					h("input", {
						type: "number", min: 1, max: 30, value: config.webMaxSteps ?? 12,
						onChange: (event) => patch("webMaxSteps", Number(event.target.value)),
						style: inputStyle,
					}),
				),

				h("div", { style: rowStyle },
					h("div", { style: { minWidth: 0 } },
						h("div", { style: labelStyle }, "超时（分钟）"),
						h("div", { style: hintStyle }, "超过这个时间就放弃，1~15"),
					),
					h("input", {
						type: "number", min: 1, max: 15, value: config.webTimeoutMinutes ?? 4,
						onChange: (event) => patch("webTimeoutMinutes", Number(event.target.value)),
						style: inputStyle,
					}),
				),
				// ── 刷B站（快捷模式）─────────────────────────────────────────
				h("div", { style: { marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.16))" } },
					h("div", { style: { fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary)", marginBottom: 4 } }, "刷B站（快捷模式）"),
					h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", marginBottom: 8 } },
						"这里只管常用开关；完整设置（关键词、人设、报告详细度、现在跑一轮）在 设置 → 刷B站"),

					bili === null
						? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, "还没装上「刷B站」插件")
						: h("div", { style: { display: "flex", flexDirection: "column", gap: 4 } },
							h("div", { style: rowStyle },
								h("div", { style: { minWidth: 0 } },
									h("div", { style: labelStyle }, "运行模式"),
									h("div", { style: hintStyle }, "只看日报 / 日报+评论 @ 你 / 全自动（评论 + 回复）"),
								),
								h("select", {
									value: bili.mode ?? "report",
									onChange: (event) => patchBili("mode", event.target.value),
									style: Object.assign({}, inputStyle, { width: 190, height: 30 }),
								},
									h("option", { value: "report" }, "只看日报"),
									h("option", { value: "comments" }, "日报 + 评论 @ 我"),
									h("option", { value: "full" }, "全自动（评论 + 回复）"),
								),
							),
							h("div", { style: rowStyle },
								h("div", { style: { minWidth: 0 } },
									h("div", { style: labelStyle }, "自动跑的时间段"),
									h("div", { style: hintStyle }, "中午 12:00–14:00 / 晚上 18:00–09:00（插件只支持这两段）"),
								),
								h("div", { style: { display: "flex", gap: 12, alignItems: "center" } },
									h("label", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } },
										h("input", { type: "checkbox", checked: bili.noon === true, onChange: (event) => patchBili("noon", event.target.checked) }), " 中午"),
									h("label", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } },
										h("input", { type: "checkbox", checked: bili.night === true, onChange: (event) => patchBili("night", event.target.checked) }), " 晚上"),
								),
							),
							h("div", { style: rowStyle },
								h("div", { style: { minWidth: 0 } },
									h("div", { style: labelStyle }, "每天最多挑几条"),
									h("div", { style: hintStyle }, "1~50，够用就行"),
								),
								h("input", {
									type: "number", min: 1, max: 50, value: bili.perDay ?? 5,
									onChange: (event) => patchBili("perDay", Number(event.target.value)),
									style: inputStyle,
								}),
							),
							h("div", { style: rowStyle },
								h("div", { style: { minWidth: 0 } },
									h("div", { style: labelStyle }, "评论里 @ 谁"),
									h("div", { style: hintStyle }, "填 B 站昵称；留空就不 @"),
								),
								h("input", {
									type: "text", value: bili.mentionName ?? "",
									onChange: (event) => patchBili("mentionName", event.target.value),
									style: Object.assign({}, inputStyle, { width: 140 }),
								}),
							),
							h("div", { style: { display: "flex", alignItems: "center", gap: 12, paddingTop: 10 } },
								h("button", {
									type: "button", onClick: saveBili,
									style: { height: 30, padding: "0 14px", borderRadius: 8, border: "none", cursor: "pointer",
										background: "var(--dsw-alias-interactive-bg-accent, #3b82f6)", color: "#fff", fontSize: 12 },
								}, "保存刷B站模式"),
								h("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, biliStatus),
							),
						),
				),
				// ── 梗库（B站学到的）─────────────────────────────────────────
				h("div", { style: { marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.16))" } },
					h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 } },
						h("div", { style: { fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "梗库（B站学到的）"),
						h("div", { style: { display: "flex", gap: 8 } },
							h("button", {
								type: "button", onClick: relearnMemes,
								style: { height: 26, padding: "0 10px", borderRadius: 6, cursor: "pointer", fontSize: 12,
									border: "1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.3))",
									background: "transparent", color: "var(--dsw-alias-label-primary)" },
							}, "重新学习"),
							h("button", {
								type: "button", onClick: loadMemes,
								style: { height: 26, padding: "0 10px", borderRadius: 6, cursor: "pointer", fontSize: 12,
									border: "1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.3))",
									background: "transparent", color: "var(--dsw-alias-label-primary)" },
							}, "刷新"),
						),
					),
					h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", marginBottom: 8 } },
						"阿圆聊天时会用这里的梗（一次最多一个）；觉得不合适的点 × 删掉"),

					memes === null
						? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, "读取中…")
						: h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
							(memes.interests || []).length > 0
								? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-primary)" } },
									"最近关注：" + memes.interests.slice(0, 4).join("；"))
								: null,
							(memes.style || []).length > 0
								? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } },
									"说话方式：" + memes.style.slice(0, 3).join("；"))
								: null,
							h("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 } },
								...((memes.memes || []).map((meme) => h("span", {
									key: meme.term,
									style: { display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px", borderRadius: 999,
										fontSize: 12, border: "1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.3))",
										color: "var(--dsw-alias-label-primary)" },
								},
									meme.term,
									h("button", {
										type: "button", onClick: () => deleteMeme(meme.term),
										title: "删掉这个梗",
										style: { border: "none", background: "transparent", cursor: "pointer", padding: 0, fontSize: 12, color: "var(--dsw-alias-label-secondary)" },
									}, "×"),
								))),
							),
							memesStatus === "" ? null : h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, memesStatus),
						),
				),
				// ── 人格卡学习记录 ──────────────────────────────────────────
				h("div", { style: { marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.16))" } },
					h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 } },
						h("div", { style: { fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "人格卡学习记录"),
						h("button", {
							type: "button", onClick: loadGrowth,
							style: { height: 26, padding: "0 10px", borderRadius: 6, cursor: "pointer", fontSize: 12,
								border: "1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.3))",
								background: "transparent", color: "var(--dsw-alias-label-primary)" },
						}, "刷新"),
					),
					h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", marginBottom: 8 } },
						"每次学习都会在原有基础上累加，并留一版快照（characters/.history）"),
					growth === null
						? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, "读取中…")
						: (growth.versions.length === 0
							? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, "还没有学习记录")
							: h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
								...growth.versions.map((version) => h("div", {
									key: version.at,
									style: { fontSize: 12, padding: "6px 8px", borderRadius: 6, background: "var(--dsw-alias-surface-secondary, rgba(127,127,127,.06))",
										color: "var(--dsw-alias-label-primary)" },
								},
									h("div", { style: { fontWeight: 600 } }, String(version.at || "").replace("T", " ")),
									h("div", { style: { color: "var(--dsw-alias-label-secondary)", marginTop: 2 } },
										[
											(version.addedInterests || []).length > 0 ? "新兴趣 " + version.addedInterests.length + " 条" : "",
											(version.addedStyle || []).length > 0 ? "新说法 " + version.addedStyle.length + " 条" : "",
											(version.addedMemes || []).length > 0 ? "新梗 " + version.addedMemes.join("、") : "",
											version.totals ? `累计 ${version.totals.memes} 梗 / ${version.totals.interests} 兴趣` : "",
										].filter(Boolean).join(" · "),
									),
								)),
							)),
				),
				// ── 两张人格卡（QQ 卡 ↔ 桌面人设）──────────────────────────
				h("div", { style: { marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.16))" } },
					h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 } },
						h("div", { style: { fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "两张人格卡"),
						h("div", { style: { display: "flex", gap: 8 } },
							h("button", {
								type: "button", onClick: syncCards,
								style: { height: 26, padding: "0 10px", borderRadius: 6, cursor: "pointer", fontSize: 12, border: "none",
									background: "var(--dsw-alias-interactive-bg-accent, #3b82f6)", color: "#fff" },
							}, "立即同步"),
							h("button", {
								type: "button", onClick: loadCards,
								style: { height: 26, padding: "0 10px", borderRadius: 6, cursor: "pointer", fontSize: 12,
									border: "1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.3))",
									background: "transparent", color: "var(--dsw-alias-label-primary)" },
							}, "刷新"),
						),
					),
					h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", marginBottom: 8 } },
						"QQ 卡是唯一依据；同步会把它渲染成「大肥鱼」插件的人设卡（含 B站学到的内容）"),
					cards === null
						? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, "读取中…")
						: h("div", { style: { display: "flex", flexDirection: "column", gap: 6, fontSize: 12 } },
							h("div", null, `QQ 卡：${cards.qq.name || "?"} · ${cards.qq.chars} 字`),
							h("div", null, `桌面人设：${cards.desktop.name || "?"} · ${cards.desktop.chars} 字 · 当前${cards.desktop.synced ? "已同步" : "待同步"}`),
							h("div", { style: { color: cards.desktop.synced ? "var(--dsw-alias-label-secondary)" : "#d97706" } },
								cards.desktop.synced ? "状态：两张卡内容一致" : "状态：旧版本，点「立即同步」更新"),
							cardsStatus === "" ? null : h("div", { style: { color: "var(--dsw-alias-label-secondary)" } }, cardsStatus),
						),
				),
				// ── 好感度一览 ──────────────────────────────────────────────
				h("div", { style: { marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.16))" } },
					h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 } },
						h("div", { style: { fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "好感度一览"),
						h("button", {
							type: "button", onClick: loadAffinity,
							style: { height: 26, padding: "0 10px", borderRadius: 6, cursor: "pointer", fontSize: 12,
								border: "1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.3))",
								background: "transparent", color: "var(--dsw-alias-label-primary)" },
						}, "刷新"),
					),
					affinity === null
						? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, "读取中…")
						: (affinity.people.length === 0
							? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, "还没有记录（群里或私聊聊几句就有了）")
							: affinityTable()),
					affinity !== null && affinity.groups.length > 0
						? h("div", { style: { marginTop: 12, display: "flex", flexDirection: "column", gap: 4 } },
							h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", marginBottom: 2 } }, "分群明细"),
							...affinity.groups.map(group => h("div", { key: group.chatKey, style: { fontSize: 12, color: "var(--dsw-alias-label-primary)" } },
								(group.private ? "私聊 " + group.chatKey.slice(8) : "群 " + group.chatKey) + "：" +
								(group.members.length === 0 ? "（空）" : group.members.map(m => `${m.name || "未知"}(${m.qq}) ${m.score}`).join(" / ")),
							)),
						)
						: null,
				),
				] : []),

				h("div", { style: { display: "flex", alignItems: "center", gap: 12, paddingTop: 12 } },
					h("button", {
						type: "button",
						onClick: save,
						disabled: busy,
						style: {
							height: 32, padding: "0 16px", borderRadius: 8, border: "none", cursor: busy ? "default" : "pointer",
							background: "var(--dsw-alias-interactive-bg-accent, #3b82f6)", color: "#fff", fontSize: 13,
						},
					}, busy ? "保存中…" : "保存并重启 QQ 桥"),
					h("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)" } }, status),
				),
			);
		}

		function apply(ctx) {
			ctx.slots.inject("settings.section", () => ctx.slots.register(
				{ name: "settings.section", id: "qq-social", order: 60, label: "LUMA" },
				Section,
			));
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	}
});
