window.__ModuleLoader__.load({
	id: "dsh-ultracode",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region lib/types/client/locales.js
		/** `ultracode` namespace dictionaries (the orchestration panel's copy). */
		/** Dictionary namespace owned by this plugin. */
		const NS = "ultracode";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"panel.title": "UltraCode 编排",
			"panel.empty": "还没有委派任务",
			"panel.count.one": "{count} 个任务",
			"panel.count.other": "{count} 个任务",
			"panel.close": "关闭编排面板",
			"task.members.one": "{count} 个成员",
			"task.members.other": "{count} 个成员",
			"task.memberCount": "{running}/{total} 运行中",
			"task.empty": "没有启动成员",
			"member.open": "打开 {name}",
			"member.round": "第 {round} 轮",
			"status.running": "运行中",
			"status.passed": "已通过",
			"status.done": "已完成",
			"status.failed": "失败",
			"status.accepted": "已接受",
			"status.rejected": "被退回",
			"role.coder": "编码",
			"role.validator": "校验",
			"mode.maximum": "最强模式",
			"mode.frugal": "省钱模式",
			"settings.nav": "UltraCode",
			"settings.title": "UltraCode 配置",
			"settings.intro": "这些值保存在设置文档中，改动立即生效，无需重启。",
			"settings.unavailable": "Host 尚未提供 UltraCode 服务，或当前会话没有写入权限。",
			"settings.readonly": "当前设置为只读。",
			"settings.saving": "正在保存…",
			"settings.saved": "已保存",
			"settings.failed": "保存失败：{error}",
			"settings.mode": "成本模式",
			"settings.mode.hint": "最强模式全用最强模型；省钱模式用便宜模型编码、最强模型校验。",
			"settings.catalog": "模型目录",
			"settings.catalog.hint": "顺序即等级：第一项是最强，最后一项是最便宜。",
			"settings.route.add": "添加路由",
			"settings.route.remove": "移除",
			"settings.route.provider": "提供方",
			"settings.route.model": "模型",
			"settings.route.effort": "推理强度",
			"settings.roles": "角色路由",
			"settings.roles.hint": "留空则按目录等级自动选择。",
			"settings.role.coder": "编码",
			"settings.role.validator": "校验",
			"settings.role.vision": "视觉",
			"settings.keyword": "激活关键词",
			"settings.keyword.hint": "在消息里写这个词即开启 UltraCode。",
			"settings.reminders": "提醒间隔",
			"settings.reminders.hint": "每隔多少轮重述一次 UltraCode 策略；0 表示不再提醒。",
			"settings.section": "提示词模板",
			"settings.section.hint": "空则使用内置模板；{mode} 与 {routes} 会被替换。",
			"settings.summary": "配置模式、模型目录、角色与提醒节奏。",
			"settings.effort.default": "默认",
			"settings.route.empty": "还没有路由",
			"settings.field.section": "提示词模板",
			"settings.field.section.hint": "空则使用内置模板；{mode} 与 {routes} 会被替换。",
			"settings.field.catalog": "模型目录",
			"settings.field.roles": "角色路由",
			"settings.field.mode": "成本模式",
			"settings.field.mode.hint": "最强模式全用最强模型；省钱模式用便宜模型编码、最强模型校验。",
			"settings.field.keyword": "激活关键词",
			"settings.field.keyword.hint": "在消息里写这个词即开启 UltraCode。",
			"settings.field.reminderEveryTurns": "提醒间隔",
			"settings.field.reminderEveryTurns.hint": "每隔多少轮重述一次 UltraCode 策略；0 表示不再提醒。",
			"settings.field.provider": "子代理提供方",
			"settings.field.provider.hint": "启动子代理的注册提供方名称。",
			"settings.field.toolName": "工具名称",
			"settings.field.toolName.hint": "模型调用的工具名。",
			"settings.field.maxValidationRounds": "校验轮数",
			"settings.field.maxValidationRounds.hint": "编码与校验之间往返的最大轮数；0 表示只写一次。",
			"settings.field.maxTaskTokens": "任务 token 预算",
			"settings.field.maxTaskTokens.hint": "整个任务的 token 上限；达到后不再开始新一轮。",
			"settings.field.maxConcurrentMembers": "并发成员上限",
			"settings.field.maxConcurrentMembers.hint": "同时运行的子代理数量；0 表示按机器核数推导。",
			"settings.field.maxTransientRetries": "瞬时失败重试",
			"settings.field.maxTransientRetries.hint": "供应商瞬时错误的重试次数。",
			"settings.field.retryBackoffMs": "重试退避",
			"settings.field.retryBackoffMs.hint": "两次重试之间的等待毫秒数。"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"panel.title": "UltraCode orchestration",
			"panel.empty": "No delegated tasks yet",
			"panel.count.one": "{count} task",
			"panel.count.other": "{count} tasks",
			"panel.close": "Close the orchestration panel",
			"task.members.one": "{count} member",
			"task.members.other": "{count} members",
			"task.memberCount": "{running}/{total} running",
			"task.empty": "No members started",
			"member.open": "Open {name}",
			"member.round": "round {round}",
			"status.running": "Running",
			"status.passed": "Passed",
			"status.done": "Done",
			"status.failed": "Failed",
			"status.accepted": "Accepted",
			"status.rejected": "Rejected",
			"role.coder": "Coder",
			"role.validator": "Validator",
			"mode.maximum": "Maximum",
			"mode.frugal": "Frugal",
			"settings.nav": "UltraCode",
			"settings.title": "UltraCode configuration",
			"settings.intro": "These values live in the settings document; changes apply immediately without a restart.",
			"settings.unavailable": "The Host does not serve UltraCode, or this session cannot write settings.",
			"settings.readonly": "These settings are read-only.",
			"settings.saving": "Saving…",
			"settings.saved": "Saved",
			"settings.failed": "Save failed: {error}",
			"settings.mode": "Cost mode",
			"settings.mode.hint": "Maximum runs every role on the strongest model; frugal codes cheaply and validates expensively.",
			"settings.catalog": "Model catalog",
			"settings.catalog.hint": "Order is the tier: the first entry is strongest, the last is cheapest.",
			"settings.route.add": "Add route",
			"settings.route.remove": "Remove",
			"settings.route.provider": "Provider",
			"settings.route.model": "Model",
			"settings.route.effort": "Reasoning effort",
			"settings.roles": "Role routes",
			"settings.roles.hint": "Empty means the tier picks one from the catalog.",
			"settings.role.coder": "Coder",
			"settings.role.validator": "Validator",
			"settings.role.vision": "Vision",
			"settings.keyword": "Activation keyword",
			"settings.keyword.hint": "Mention this word in a message to turn UltraCode on.",
			"settings.reminders": "Reminder interval",
			"settings.reminders.hint": "Turns between policy restatements; 0 stops them.",
			"settings.section": "Prompt template",
			"settings.section.hint": "Empty uses the built-in template; {mode} and {routes} are substituted.",
			"settings.summary": "Configure the mode, the model catalog, the roles, and the reminder cadence.",
			"settings.effort.default": "Default",
			"settings.route.empty": "No routes yet",
			"settings.field.section": "Prompt template",
			"settings.field.section.hint": "Empty uses the built-in template; {mode} and {routes} are substituted.",
			"settings.field.catalog": "Model catalog",
			"settings.field.roles": "Role routes",
			"settings.field.mode": "Cost mode",
			"settings.field.mode.hint": "Maximum runs every role on the strongest model; frugal codes cheaply and validates expensively.",
			"settings.field.keyword": "Activation keyword",
			"settings.field.keyword.hint": "Mention this word in a message to turn UltraCode on.",
			"settings.field.reminderEveryTurns": "Reminder interval",
			"settings.field.reminderEveryTurns.hint": "Turns between policy restatements; 0 stops them.",
			"settings.field.provider": "Subagent provider",
			"settings.field.provider.hint": "Registered provider name that starts the members.",
			"settings.field.toolName": "Tool name",
			"settings.field.toolName.hint": "The tool name the model calls.",
			"settings.field.maxValidationRounds": "Validation rounds",
			"settings.field.maxValidationRounds.hint": "Round-trips between coding and validation; 0 writes once.",
			"settings.field.maxTaskTokens": "Task token budget",
			"settings.field.maxTaskTokens.hint": "Token ceiling for the whole task; no round starts past it.",
			"settings.field.maxConcurrentMembers": "Concurrent members",
			"settings.field.maxConcurrentMembers.hint": "Subagents running at once; 0 derives the count from the machine.",
			"settings.field.maxTransientRetries": "Transient retries",
			"settings.field.maxTransientRetries.hint": "Retries allowed for a transient provider failure.",
			"settings.field.retryBackoffMs": "Retry backoff",
			"settings.field.retryBackoffMs.hint": "Milliseconds between retries."
		};
		//#endregion
		//#region \0dsh-css:UltraCodeSettings.module.css.mjs
		const settingsCss = ".UCsetg_card{margin:4px 0;flex-direction:column;gap:14px;display:flex}.UCsetg_title{margin:0;font-size:15px;font-weight:600;color:var(--dsh-text-primary,var(--dsw-alias-label-primary))}.UCsetg_intro,.UCsetg_note,.UCsetg_status{margin:0;font-size:12px;color:var(--dsh-text-muted,var(--dsw-alias-label-tertiary))}.UCsetg_status{color:var(--dsh-text-primary,var(--dsw-alias-label-primary))}.UCsetg_group{flex-direction:column;gap:8px;display:flex;border-top:1px solid var(--dsh-border-subtle,var(--dsw-alias-border-l));padding-top:12px}.UCsetg_groupTitle{margin:0;font-size:13px;font-weight:600;color:var(--dsh-text-primary,var(--dsw-alias-label-primary))}.UCsetg_field{flex-direction:column;gap:4px;display:flex}.UCsetg_fieldLabel{font-size:12px;font-weight:500;color:var(--dsh-text-primary,var(--dsw-alias-label-primary))}.UCsetg_fieldHint{margin:0;font-size:11px;color:var(--dsh-text-muted,var(--dsw-alias-label-tertiary))}.UCsetg_select,.UCsetg_input,.UCsetg_textarea{font:inherit;font-size:13px;color:var(--dsh-text-primary,var(--dsw-alias-label-primary));background:var(--dsh-surface-raised,var(--dsw-alias-bg-l1));border:1px solid var(--dsh-border-subtle,var(--dsw-alias-border-l));border-radius:6px;padding:5px 8px;min-height:28px}.UCsetg_textarea{resize:vertical;font-family:inherit}.UCsetg_select:disabled,.UCsetg_input:disabled,.UCsetg_textarea:disabled{opacity:.55}.UCsetg_route{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.UCsetg_route>:first-child{flex:1 1 120px;min-width:0}.UCsetg_route>select{flex:1 1 140px;min-width:0}.UCsetg_roleName{flex:none;font-size:12px;min-width:64px;color:var(--dsh-text-muted,var(--dsw-alias-label-tertiary))}.UCsetg_remove,.UCsetg_add{font:inherit;font-size:12px;cursor:pointer;border-radius:6px;border:1px solid var(--dsh-border-subtle,var(--dsw-alias-border-l));background:0 0;color:var(--dsh-text-primary,var(--dsw-alias-label-primary));padding:4px 10px;min-height:28px}.UCsetg_add{align-self:flex-start}.UCsetg_check{width:16px;height:16px;accent-color:var(--dsh-accent,var(--dsw-alias-brand-primary));align-self:flex-start}.UCsetg_remove:hover,.UCsetg_add:hover{background:var(--dsh-surface-hover,var(--dsw-alias-interactive-bg-hover))}";
		const settingsTagId = "dsh-ultracode/UltraCodeSettings.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(settingsTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-ultracode";
			tag.dataset.pluginCss = settingsTagId;
			tag.textContent = settingsCss;
			document.head.appendChild(tag);
		}
		var UltraCodeSettings_module_css_default = {
			"card": "UCsetg_card",
			"title": "UCsetg_title",
			"intro": "UCsetg_intro",
			"note": "UCsetg_note",
			"status": "UCsetg_status",
			"group": "UCsetg_group",
			"groupTitle": "UCsetg_groupTitle",
			"field": "UCsetg_field",
			"fieldLabel": "UCsetg_fieldLabel",
			"fieldHint": "UCsetg_fieldHint",
			"select": "UCsetg_select",
			"input": "UCsetg_input",
			"textarea": "UCsetg_textarea",
			"route": "UCsetg_route",
			"roleName": "UCsetg_roleName",
			"remove": "UCsetg_remove",
			"add": "UCsetg_add",
			"check": "UCsetg_check"
		};
		//#endregion
//#region lib/types/client/settings-card.js
/**
* The plugin's own configuration page.
*
* The Host serves one settings form per Loader entry, and each entry declares its
* own schemastery `Config`. This page therefore renders the SERVED SCHEMA rather
* than a fixed field list: the two rows this bundle mounts (the mode controller
* and the delegation tool) have disjoint configs, and a hardcoded page would show
* one row's fields under the other's title.
*
* Field widgets follow the schema node: a `union` of `const` values becomes a
* select, a `number` with a small integer range becomes a select, a `boolean`
* becomes a checkbox, a `string` becomes an input, and an array of objects (the
* model catalog) becomes the route editor. Values are read from the settings form
* the Plugins tab uses, so an edit here and an edit there are the same document.
*
* @module @deepseek-ai/dsh-client-ui-ultracode/client/settings
*/
/** Settings namespace: the Loader entry id of the UltraCode row. */
const SETTINGS_NS = "ultracode";
/** The package name the row keys are prefixed with. */
const SETTINGS_PACKAGE = "dsh-ultracode";
/** The row ids this bundle's patch declares, in the order it declares them. */
const SETTINGS_ROWS = ["ultracode", "tool-ultracode-delegate"];
/** Fallback reasoning rungs when a model declares none. */
const NO_EFFORTS = [];
/**
* Flatten the Host's model catalog into the select options a route needs.
* @param catalog - the `session/modelCatalog` value, or undefined while loading.
* @returns one option per provider and, per route, its models.
*/
function routeOptions(catalog) {
	const providers = [];
	const models = new Map();
	const efforts = new Map();
	for (const group of catalog?.groups ?? []) {
		providers.push({ value: group.id, label: group.label ?? group.id });
		const list = [];
		for (const model of group.models ?? []) {
			const value = String(model.id);
			list.push({ value, label: model.label ?? value });
			efforts.set(`${group.id}\u0000${value}`, model.reasoning?.efforts ?? NO_EFFORTS);
		}
		models.set(group.id, list);
	}
	return {
		providers,
		models,
		effortsFor: (provider, model) => efforts.get(`${provider ?? ""}\u0000${model ?? ""}`) ?? NO_EFFORTS
	};
}
/** True when a schema node is an object with a `dict` of named members. */
function isObjectNode(node) {
	return node !== undefined && node.type === "object" && typeof node.dict === "object" && node.dict !== null;
}
/** Resolve one schema reference id to its node. */
function nodeAt(schema, id) {
	return typeof id === "number" ? schema?.refs?.[id] : undefined;
}
/**
* Resolve the members of one object node.
* @param schema - the served schema envelope.
* @param node - the object node.
* @returns the members in declaration order.
*/
function membersOf(schema, node) {
	const members = [];
	for (const [key, ref] of Object.entries(node?.dict ?? {})) {
		const child = nodeAt(schema, ref);
		if (child !== undefined) members.push([key, child]);
	}
	return members;
}
/**
* Build the choices a `union` (or bounded `number`) node offers.
* @param schema - the served schema envelope.
* @param node - the field node.
* @returns the option list, or undefined when the node is free-form.
*/
function choicesOf(schema, node) {
	if (node.type === "union") {
		const options = [];
		for (const ref of node.list ?? []) {
			const member = nodeAt(schema, ref);
			if (member === undefined) continue;
			const value = member.type === "const" ? member.value : undefined;
			if (value === undefined) continue;
			options.push({ value: String(value), label: String(value) });
		}
		return options.length === 0 ? undefined : options;
	}
	if (node.type === "number") {
		const { min, max } = node.meta ?? {};
		if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
		const values = [];
		for (let value = min; value <= max; value += 1) values.push(value);
		if (values.length === 0 || values.length > 12) return undefined;
		return values.map((value) => ({ value: String(value), label: String(value) }));
	}
	return undefined;
}
/**
* Render a label row around one control.
* @param props - label, hint, and the control.
* @returns the labelled control.
*/
function Field({ label, hint, children }) {
	return react_jsx_runtime.jsxs("label", {
		className: UltraCodeSettings_module_css_default.field,
		children: [
			react_jsx_runtime.jsx("span", { className: UltraCodeSettings_module_css_default.fieldLabel, children: label }),
			children,
			hint === undefined ? null : react_jsx_runtime.jsx("span", { className: UltraCodeSettings_module_css_default.fieldHint, children: hint })
		]
	});
}
/**
* Render one `<select>`.
* @param props - value, options, change handler, and disabled flag.
* @returns the select control.
*/
function Select({ value, options, onChange, disabled, placeholder }) {
	const known = options.some((option) => option.value === value);
	return react_jsx_runtime.jsxs("select", {
		className: UltraCodeSettings_module_css_default.select,
		value: value ?? "",
		disabled,
		onChange: (event) => { onChange(event.target.value); },
		children: [
			placeholder === undefined ? null : react_jsx_runtime.jsx("option", { value: "", children: placeholder }),
			known || value === undefined || value === "" ? null : react_jsx_runtime.jsx("option", { value, children: value }),
			...options.map((option) => react_jsx_runtime.jsx("option", { value: option.value, children: option.label }, option.value))
		]
	});
}
/**
* Read one route field out of a stored value.
* @param routes - the stored array.
* @param index - the route's position.
* @returns the route, or an empty one.
*/
function routeAt(routes, index) {
	return Array.isArray(routes) ? routes[index] ?? {} : {};
}
/**
* The dictionary key a schema field uses.
* @param path - the field's dotted path inside the config object.
* @returns the dictionary key, which falls back to the raw path.
*/
function labelKey(path) {
	return `settings.field.${path.replace(/\./g, "-")}`;
}
/**
* Render one provider/model/effort triple.
* @param props - the route, its options, and the change handler.
* @returns the three selects and, when removable, the remove button.
*/
function RouteRow({ route, options, disabled, t, onChange, onRemove }) {
	const current = route ?? {};
	const rungs = options.effortsFor(current.provider, current.model);
	return react_jsx_runtime.jsxs("div", {
		className: UltraCodeSettings_module_css_default.route,
		children: [
			react_jsx_runtime.jsx(Select, {
				value: current.provider ?? "",
				disabled,
				placeholder: t("settings.route.provider"),
				options: options.providers,
				onChange: (next) => { onChange({ provider: next, model: undefined }); }
			}),
			react_jsx_runtime.jsx(Select, {
				value: current.model ?? "",
				disabled,
				placeholder: t("settings.route.model"),
				options: options.models.get(current.provider ?? "") ?? [],
				onChange: (next) => { onChange({ model: next }); }
			}),
			react_jsx_runtime.jsx(Select, {
				value: current.effort ?? "",
				disabled,
				placeholder: t("settings.effort.default"),
				options: rungs.map((rung) => ({ value: rung, label: rung })),
				onChange: (next) => { onChange({ effort: next === "" ? undefined : next }); }
			}),
			onRemove === undefined ? null : react_jsx_runtime.jsx("button", {
				type: "button",
				className: UltraCodeSettings_module_css_default.remove,
				disabled,
				onClick: onRemove,
				children: t("settings.route.remove")
			})
		]
	});
}
/**
* Render one schema field.
*
* The widget follows the node, and the field's dictionary key follows its path,
* so a field this page has no copy for still renders under its own name instead
* of disappearing.
* @param props - the field node, its value, the writer, and the option set.
* @returns the labelled control, or null when the node is unsupported.
*/
function SchemaField({ schema, path, node, value, disabled, t, options, write }) {
	const label = t(labelKey(path));
	const hintKey = `${labelKey(path)}.hint`;
	const hint = t(hintKey);
	const hintText = hint === hintKey ? undefined : hint;
	const choices = choicesOf(schema, node);
	if (choices !== undefined) {
		return react_jsx_runtime.jsx(Field, {
			label,
			hint: hintText,
			children: react_jsx_runtime.jsx(Select, {
				value: value === undefined ? "" : String(value),
				disabled,
				options: choices,
				onChange: (next) => { void write(path, node.type === "number" ? Number(next) : next); }
			})
		});
	}
	if (node.type === "boolean") {
		return react_jsx_runtime.jsx(Field, {
			label,
			hint: hintText,
			children: react_jsx_runtime.jsx("input", {
				className: UltraCodeSettings_module_css_default.check,
				type: "checkbox",
				checked: value === true,
				disabled,
				onChange: (event) => { void write(path, event.target.checked); }
			})
		});
	}
	if (node.type === "string") {
		const multiline = (node.meta?.min ?? 0) > 200 || path === "section";
		return react_jsx_runtime.jsx(Field, {
			label,
			hint: hintText,
			children: multiline
				? react_jsx_runtime.jsx("textarea", {
					className: UltraCodeSettings_module_css_default.textarea,
					rows: 4,
					value: value ?? "",
					disabled,
					onChange: (event) => { void write(path, event.target.value); }
				})
				: react_jsx_runtime.jsx("input", {
					className: UltraCodeSettings_module_css_default.input,
					value: value ?? "",
					disabled,
					onChange: (event) => { void write(path, event.target.value); }
				})
		});
	}
	// `catalog` is an ARRAY of route objects, so an array node whose inner node is
	// an object renders as the repeatable route editor; the role map is the object
	// form of the same triple.
	// A bounded integer with a short range is a select (the reminder cadence), but a
	// number whose range is wide or open must still be editable, so it renders as a
	// number input rather than disappearing from the page.
	if (node.type === "number") {
		const { min, max, step } = node.meta ?? {};
		return react_jsx_runtime.jsx(Field, {
			label,
			hint: hintText,
			children: react_jsx_runtime.jsx("input", {
				className: UltraCodeSettings_module_css_default.input,
				type: "number",
				value: value === undefined ? "" : String(value),
				min,
				max,
				step: step ?? 1,
				disabled,
				onChange: (event) => {
					const raw = event.target.value;
					void write(path, raw === "" ? undefined : Number(raw));
				}
			})
		});
	}
	if (isObjectNode(node) || (node.type === "array" && isObjectNode(nodeAt(schema, node.inner)))) {
		return renderObject({ schema, path, node, value, disabled, t, options, write, label, hintText });
	}
	return null;
}
/**
* Render an object node: the model catalog becomes a repeatable route list and
* the role map becomes three fixed triples; any other object renders its members.
* @param props - the node, its value, and the writer.
* @returns the group.
*/
function renderObject({ schema, path, node, value, disabled, t, options, write, label, hintText }) {
	const members = membersOf(schema, node);
	const record = value ?? {};
	if (path === "catalog" || path === "roles") {
		const isList = path === "catalog";
		const rows = isList
			? (Array.isArray(record.routes) ? record.routes : [])
			: members.map(([key]) => key);
		const groupKey = isList ? "settings.catalog" : "settings.roles";
		const hintGroupKey = `${groupKey}.hint`;
		const groupHint = t(hintGroupKey);
		return react_jsx_runtime.jsxs("div", {
			className: UltraCodeSettings_module_css_default.group,
			children: [
				react_jsx_runtime.jsx("h3", { className: UltraCodeSettings_module_css_default.groupTitle, children: t(groupKey) }),
				react_jsx_runtime.jsx("p", { className: UltraCodeSettings_module_css_default.fieldHint, children: groupHint === hintGroupKey ? t("settings.route.empty") : groupHint }),
				...rows.map((row, index) => {
					if (isList) {
						const current = routeAt(rows, index);
						return react_jsx_runtime.jsx(RouteRow, {
							route: current,
							options,
							disabled,
							t,
							onChange: (patch) => {
								const next = rows.map((entry, at) => at === index ? { ...entry, ...patch } : entry);
								void write("catalog", { routes: next });
							},
							onRemove: () => { void write("catalog", { routes: rows.filter((entry, at) => at !== index) }); }
						}, `${current.provider ?? ""}:${current.model ?? ""}:${String(index)}`);
					}
					const current = record[row] ?? {};
					return react_jsx_runtime.jsx(RouteRow, {
						route: current,
						options,
						disabled,
						t,
						onChange: (patch) => { void write(`roles.${row}`, { ...current, ...patch }); }
					}, row);
				}),
				isList && rows.length === 0 ? react_jsx_runtime.jsx("p", { className: UltraCodeSettings_module_css_default.fieldHint, children: t("settings.route.empty") }) : null,
				isList ? react_jsx_runtime.jsx("button", {
					type: "button",
					className: UltraCodeSettings_module_css_default.add,
					disabled,
					onClick: () => { void write("catalog", { routes: [...rows, { provider: options.providers[0]?.value, model: undefined }] }); },
					children: t("settings.route.add")
				}) : null
			]
		});
	}
	return react_jsx_runtime.jsxs("div", {
		className: UltraCodeSettings_module_css_default.group,
		children: [
			react_jsx_runtime.jsx("h3", { className: UltraCodeSettings_module_css_default.groupTitle, children: label }),
			hintText === undefined ? null : react_jsx_runtime.jsx("p", { className: UltraCodeSettings_module_css_default.fieldHint, children: hintText }),
			...members.map(([key, child]) => react_jsx_runtime.jsx(SchemaField, {
				schema,
				path: `${path}.${key}`,
				node: child,
				value: record[key],
				disabled,
				t,
				options,
				write
			}, key))
		]
	});
}
/** Snapshot an entry without a form renders from; one frozen object so `useSyncExternalStore` stays stable. */
const EMPTY_FORM_SNAPSHOT = Object.freeze({ status: "unavailable", value: void 0, writable: false });
/**
* Render the UltraCode settings page.
* @param props - the injected form controller, the schema envelope, and the dictionary.
* @returns the page.
*/
function UltraCodeSettings(props) {
	const { settingsForm: form, loadCatalog, t, schema } = props;
	// Every hook runs before any early return: this entry renders both as the
	// one-liner under the row's title and as the page body, and a hook order
	// that differs between those two calls is an error the slot boundary turns
	// into a blacked-out page.
	const subscribe = react.useCallback((listener) => form === void 0 ? () => {} : form.subscribe(listener), [form]);
	const read = react.useCallback(() => form === void 0 ? EMPTY_FORM_SNAPSHOT : form.getSnapshot(), [form]);
	const snapshot = react.useSyncExternalStore(subscribe, read, read);
	const [catalog, setCatalog] = react.useState(undefined);
	const [status, setStatus] = react.useState("");
	react.useEffect(() => {
		if (loadCatalog === void 0) return undefined;
		let live = true;
		loadCatalog().then((response) => {
			if (!live || response?.ok !== true) return;
			setCatalog(response.value);
		}).catch(() => {});
		return () => { live = false; };
	}, [loadCatalog]);
	if (props.view === "summary") return typeof t === "function" ? t("settings.summary") : "UltraCode routing and delegation";
	if (form === void 0) return null;
	const options = routeOptions(catalog);
	const value = snapshot.value ?? {};
	const disabled = snapshot.writable !== true || snapshot.status !== "ready";
	// A dotted path addresses a NESTED member, so the mutation carries one path
	// segment per part: `set()` would send the whole string as a single key and
	// the Host would write a field named "roles.coder" that no reader looks at.
	const write = async (path, next) => {
		setStatus("saving");
		const accepted = await form.mutate([{ op: "set", path: path.split("."), value: next }]);
		setStatus(accepted === false ? "failed" : "saved");
	};
	if (snapshot.status === "unavailable")
		return react_jsx_runtime.jsx("p", { className: UltraCodeSettings_module_css_default.note, children: t("settings.unavailable") });
	if (snapshot.status === "loading")
		return react_jsx_runtime.jsx("p", { className: UltraCodeSettings_module_css_default.note, children: t("settings.saving") });
	const root = typeof schema?.uid === "number" ? nodeAt(schema, schema.uid) : undefined;
	return react_jsx_runtime.jsxs("section", {
		className: UltraCodeSettings_module_css_default.card,
		children: [
			react_jsx_runtime.jsx("h2", { className: UltraCodeSettings_module_css_default.title, children: t("settings.title") }),
			react_jsx_runtime.jsx("p", { className: UltraCodeSettings_module_css_default.intro, children: t("settings.intro") }),
			disabled ? react_jsx_runtime.jsx("p", { className: UltraCodeSettings_module_css_default.note, children: t("settings.readonly") }) : null,
			status === "" ? null : react_jsx_runtime.jsx("p", { className: UltraCodeSettings_module_css_default.status, children: t(`settings.${status}`) }),
			root === undefined
				? react_jsx_runtime.jsx("p", { className: UltraCodeSettings_module_css_default.note, children: t("settings.unavailable") })
				: react_jsx_runtime.jsx(react_jsx_runtime.Fragment, {
					children: membersOf(schema, root).map(([key, child]) => react_jsx_runtime.jsx(SchemaField, {
						schema,
						path: key,
						node: child,
						// The root's members each read their OWN value: handing the whole
						// record down made every control render the same object.
						value: value[key],
						disabled,
						t,
						options,
						write
					}))
				}),
			react_jsx_runtime.jsx("pre", {
				className: UltraCodeSettings_module_css_default.note,
				style: { display: "none" },
				children: JSON.stringify(snapshot.user ?? {})
			})
		]
	});
}
//#endregion
		//#region lib/types/client/task-definition.js
		/**
		* Durable UltraCode orchestration folded into one Chat node per task.
		*
		* The task heading, each member, and each outcome are separate log records, so
		* the node reproduces exactly what ran — including the model a child actually
		* used — instead of re-deriving routing from the tool call's arguments.
		*
		* Hosts on DeepSeek Harness 0.2.x write ignorable `plugin:dsh-ultracode/<kind>`
		* records; 0.1.x hosts write `ultracode/<kind>` events. Both are read.
		*
		* @module @deepseek-ai/dsh-client-ui-ultracode/client
		*/
		const RECORD_PREFIX = "plugin:dsh-ultracode/";
		/** Normalize an UltraCode record type to `ultracode/<kind>`. */
		function ultraType(event) {
			const type = event?.type;
			return typeof type === "string" && type.startsWith(RECORD_PREFIX) ? "ultracode/" + type.slice(RECORD_PREFIX.length) : type;
		}
		function locationClosed(location) {
			if (location.kind === "step") return location.step.status === "closed" || location.turn.status === "closed";
			return location.kind === "turn" && location.turn.status === "closed";
		}
		/** Whether a member's stop reason is a finished run (a coder that hit max-tokens still answered). */
		function finished(stopReason) {
			return stopReason === "completed" || stopReason === "max-tokens";
		}
		/**
		* One member's settled status. A validator reports its verdict; a coder
		* reports whether its run finished, read from the stop reason so records
		* written before `accepted` carried a coder's success still render right.
		*/
		function memberStatus(row, data) {
			if (row.role === "validator") {
				if (data.accepted === true) return "accepted";
				return finished(data.stopReason) ? "rejected" : "failed";
			}
			return finished(data.stopReason) || data.accepted === true ? "done" : "failed";
		}
		/** Fold the task's own state into the published row. */
		function projectTask(context, location) {
			const state = context.state;
			const interrupted = state.ended === void 0 && locationClosed(location);
			return {
				taskId: context.id,
				label: state.label,
				mode: state.mode,
				members: state.members.map((row) => ({
					...row,
					status: interrupted && row.status === "running" ? "failed" : row.status
				})),
				status: state.ended === void 0 ? interrupted ? "failed" : "running" : state.ended.passed ? "passed" : "failed"
			};
		}
		/** Durable UltraCode task family folded into one keyed Chat node. */
		const ultraTaskDefinition = {
			kind: "ultracode-task",
			target: "chat",
			match: (event) => {
				switch (ultraType(event)) {
					case "ultracode/task": return {
						id: event.data.taskId,
						role: "start"
					};
					case "ultracode/member":
					case "ultracode/outcome":
					case "ultracode/task-end": return {
						id: event.data.taskId,
						role: "update"
					};
					default: return null;
				}
			},
			start: (_context, match) => {
				if (ultraType(match.event) !== "ultracode/task") throw new Error("ultracode-task start requires an ultracode task record");
				return {
					label: match.event.data.label,
					mode: match.event.data.mode,
					members: []
				};
			},
			update: (context, match) => {
				const type = ultraType(match.event);
				if (type === "ultracode/member") {
					const data = match.event.data;
					const row = {
						childId: data.childId,
						role: data.role,
						model: data.model,
						round: data.round,
						status: "running"
					};
					return {
						...context.state,
						members: [...context.state.members, row]
					};
				}
				if (type === "ultracode/outcome") {
					const data = match.event.data;
					return {
						...context.state,
						members: context.state.members.map((row) => row.childId === data.childId && row.status === "running" ? {
							...row,
							status: memberStatus(row, data)
						} : row)
					};
				}
				if (type === "ultracode/task-end") return {
					...context.state,
					ended: { passed: match.event.data.passed }
				};
				return context.state;
			},
			buildViewNode: (context) => {
				if (context.start === void 0) return null;
				return {
					key: context.key,
					kind: "ultracode-task",
					id: context.id,
					target: "chat",
					anchorSeq: context.start.event.seq,
					location: context.start.location,
					visibility: "visible",
					data: projectTask(context, context.start.location)
				};
			}
		};
		//#endregion
		//#region \0dsh-css:UltraCodePanel.module.css.mjs
		const css = ".SDUSsq_root{margin:8px 0;display:block}.SDUSsq_header{width:100%;min-height:28px;color:var(--dsh-text-primary,var(--dsw-alias-label-primary));border-radius:6px;align-items:center;gap:6px;padding:0 6px;font-size:13px;display:flex}.SDUSsq_separator{background:var(--dsh-border-subtle,var(--dsw-alias-border-l));flex:none;width:1px;height:12px}.SDUSsq_summary{color:var(--dsh-text-muted,var(--dsw-alias-label-tertiary));font-size:12px}.SDUSsq_statusTail{color:var(--dsh-text-muted,var(--dsw-alias-label-tertiary));align-items:center;gap:4px;margin-left:auto;font-size:12px;display:inline-flex}.SDUSsq_members{flex-direction:column;gap:1px;padding:2px 0 2px 10px;display:flex}.SDUSsq_member{width:100%;min-height:24px;color:var(--dsh-text-primary,var(--dsw-alias-label-primary));text-align:left;cursor:pointer;background:0 0;border:none;border-radius:6px;align-items:center;gap:6px;padding:0 6px;font-size:13px;display:flex}.SDUSsq_member:hover{background:var(--dsh-surface-hover,var(--dsw-alias-interactive-bg-hover))}.SDUSsq_dotSlot{flex:none;align-items:center;display:inline-flex}.SDUSsq_memberLabel{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.SDUSsq_memberMeta{color:var(--dsh-text-muted,var(--dsw-alias-label-tertiary));white-space:nowrap;margin-left:auto;font-size:12px}.SDUSsq_empty{color:var(--dsh-text-muted,var(--dsw-alias-label-tertiary));font-size:12px}";
		const tagId = "dsh-ultracode/UltraCodePanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-ultracode";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var UltraCodePanel_module_css_default = {
			"dotSlot": "SDUSsq_dotSlot",
			"empty": "SDUSsq_empty",
			"header": "SDUSsq_header",
			"member": "SDUSsq_member",
			"memberLabel": "SDUSsq_memberLabel",
			"memberMeta": "SDUSsq_memberMeta",
			"members": "SDUSsq_members",
			"root": "SDUSsq_root",
			"separator": "SDUSsq_separator",
			"statusTail": "SDUSsq_statusTail",
			"summary": "SDUSsq_summary"
		};
		//#endregion
		//#region lib/types/client/UltraCodePanel.js
		const MEMBER_STATUS_KEYS = {
			running: "status.running",
			done: "status.done",
			accepted: "status.accepted",
			rejected: "status.rejected",
			failed: "status.failed"
		};
		/** The chevron the disclosure row shows; the 14px artwork was renamed on 0.2.x. */
		const ChevronIcon = _deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14 ?? _deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular ?? _deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineMedium;
		function dotState(status) {
			switch (status) {
				case "running": return "ongoing";
				case "passed":
				case "done":
				case "accepted": return "done";
				case "rejected": return "warning";
				case "failed": return "error";
				default: return "idle";
			}
		}
		/**
		* One member row: the model the child actually ran on, its role, and its
		* round. The row is the control surface — clicking opens that child session,
		* where the transcript and the Stop control live.
		*/
		function MemberRow({ member, openMember, t }) {
			const name = member.model === "" || member.model === void 0 ? member.childId : member.model;
			return (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: UltraCodePanel_module_css_default.member,
				"data-member-status": member.status,
				"aria-label": t("member.open", { name }),
				onClick: () => {
					openMember(member.childId);
				},
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						className: UltraCodePanel_module_css_default.dotSlot,
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: dotState(member.status) })
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: UltraCodePanel_module_css_default.memberLabel,
						children: name
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: UltraCodePanel_module_css_default.memberMeta,
						children: [
							t(`role.${member.role}`),
							t("member.round", { round: String(member.round) }),
							t(MEMBER_STATUS_KEYS[member.status] ?? "status.running")
						].join(" · ")
					})
				]
			});
		}
		/**
		* Durable UltraCode task panel: the group heading is the task the caller
		* delegated, and every row is one subagent that ran for it, in start order.
		* Opening a row navigates to that child's own conversation.
		*/
		function UltraCodePanel({ node, openMember, t }) {
			const [open, setOpen] = (0, react.useState)(true);
			const task = node.data;
			const running = task.members.filter((member) => member.status === "running").length;
			const summary = task.members.length === 0 ? t("task.empty") : t("task.memberCount", {
				running: String(running),
				total: String(task.members.length)
			});
			let content = null;
			if (task.members.length === 0) content = (0, react_jsx_runtime.jsx)("span", {
				className: UltraCodePanel_module_css_default.empty,
				children: t("task.empty")
			});
			else content = task.members.map((member, index) => (0, react_jsx_runtime.jsx)(MemberRow, {
				member,
				openMember,
				t
			}, `${member.childId}:${String(member.round)}:${String(index)}`));
			return (0, react_jsx_runtime.jsx)("section", {
				className: UltraCodePanel_module_css_default.root,
				"data-ultracode-task": true,
				"data-task-status": task.status,
				children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					icon: ChevronIcon === void 0 ? null : (0, react_jsx_runtime.jsx)(ChevronIcon, {}),
					title: task.label === "" ? t("panel.title") : task.label,
					open,
					expandable: true,
					onToggle: () => {
						setOpen((value) => !value);
					},
					expandOnRowClick: true,
					previewChevron: false,
					keepContentWhenOpen: true,
					rowClassName: UltraCodePanel_module_css_default.header,
					collapsedContent: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: UltraCodePanel_module_css_default.separator,
							"aria-hidden": true
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: UltraCodePanel_module_css_default.summary,
							"data-task-summary": true,
							children: summary
						}),
						(0, react_jsx_runtime.jsxs)("span", {
							className: UltraCodePanel_module_css_default.statusTail,
							"data-status": task.status,
							children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: dotState(task.status) }), (0, react_jsx_runtime.jsx)("span", { children: t(`mode.${task.mode}`) })]
						})
					] }),
					children: (0, react_jsx_runtime.jsx)("div", {
						className: UltraCodePanel_module_css_default.members,
						children: content
					})
				})
			});
		}
		//#endregion
		//#region lib/types/client/index.js
		/**
		* Browser half of UltraCode: the orchestration node that lists the subagents
		* working on each delegated task.
		*
		* It reads only durable UltraCode records, so what it shows is what ran.
		*
		* The task Definition registers through whichever conversation registry the
		* client offers — `conversationEvents` (0.1.x) or `uiConversation.events`
		* (0.2.x). Neither is a required injection: the entry activates on `slots`
		* and `locale` alone, and the Definition mounts once a registry appears.
		*
		* @module @deepseek-ai/dsh-client-ui-ultracode/client
		*/
		/** Required services for the keyed renderer and copy. */
		const inject = ["slots", "locale"];
		/**
		* Open one member's child session through whichever navigation the client offers.
		* @param ctx - the client root context.
		* @param id - the child session id.
		*/
		function openSession(ctx, id) {
			const workspace = ctx.get("uiWorkspace");
			if (typeof workspace?.openSession === "function") {
				workspace.openSession(id);
				return;
			}
			const sessions = ctx.get("sessions");
			if (typeof sessions?.open === "function") sessions.open(id);
		}
		/**
		* Mount the task Definition on the first conversation registry that appears,
		* and release the claim when that registry's scope is disposed, so a later
		* registry can take over without registering the same kind twice.
		* @param ctx - the client root context.
		*/
		function registerTaskDefinition(ctx) {
			let owner;
			const mount = (source, registry) => (scope) => {
				if (owner !== void 0) return;
				owner = source;
				scope.effect(() => () => {
					if (owner === source) owner = void 0;
				}, `ui-ultracode: task definition owner (${source})`);
				registry(scope).register(ultraTaskDefinition);
			};
			ctx.inject(["conversationEvents"], mount("conversationEvents", (scope) => scope.conversationEvents));
			ctx.inject(["uiConversation"], mount("uiConversation", (scope) => scope.uiConversation.events));
		}
		/** Register the UltraCode task Definition, dictionary, and keyed Chat renderer. */
		function apply(ctx) {
			registerTaskDefinition(ctx);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-ultracode: dictionaries");
			const settingsT = ctx.locale.bind(NS);
			// The settings page rides the 0.2.x forms service, which an older shell
			// does not provide. Naming it in the exported `inject` would leave this
			// entry pending and abort the whole application, so it is scoped here:
			// the page mounts when the service appears, in whatever order the
			// composition supplies it, and is simply absent where it never does.
			// The configuration page rides the Plugins page's `plugins.item` slot,
			// which is the seam every settings-backed plugin page in this shell
			// registers into. `whileServed` watches the settings document, so the page
			// appears exactly while the Host serves this row's namespace and leaves no
			// trace where the row was never composed.
			// A row's configuration belongs in `plugins.row.config`, a keyed slot
			// addressed by `<package name>#<row id>` with the row id the bundle's own
			// patch declares. The Plugins page then gives each such row a configure
			// control that opens the entry's page, so the form lives beside the row
			// it edits instead of beside the package. `inject` is scoped rather than
			// exported because a shell without the forms service would leave this
			// entry pending, and a pending client entry aborts the whole web boot.
			// `remote.session` is a nested service: reaching it through the `remote`
			// property needs it named in the declaring fiber's own inject list, and
			// an undeclared read throws "cannot get property ... without inject",
			// which the slot boundary turns into a page that never appears. The
			// declared scope below is the fiber that serves both the forms service
			// and the model catalog the dropdowns are built from.
			ctx.inject(["configForms", "remote", "remote.session"], (scope) => {
				const forms = scope.configForms;
				// Each row addresses its OWN settings namespace: the Plugins page asks
				// the forms service by row id, so a shared namespace would show the
				// mode's fields under the delegation row and never show its own.
				for (const rowId of SETTINGS_ROWS) {
					scope.slots.inject("plugins.row.config", () => scope.slots.register({
						name: "plugins.row.config",
						key: `${SETTINGS_PACKAGE}#${rowId}`,
						order: 60,
						label: () => settingsT("settings.nav"),
						locale: NS,
						// The outlet already passes a `form` prop of its own (the staged
						// {state, mutate} handle), so this entry publishes its controller
						// under a distinct name rather than being shadowed by it.
						// The SERVED schema travels with the form: the page renders the
						// fields this row's Config declares rather than a fixed list, so the
						// mode row and the delegation row show their own fields.
						inject: () => ({
							settingsForm: forms.get(rowId),
							schema: forms.describe().getSnapshot().view?.namespaces
								?.find((view) => view.ns === rowId)?.schema,
							loadCatalog: () => scope.remote.session.modelCatalog(),
							t: settingsT
						})
					}, UltraCodeSettings));
				}
			});
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "ultracode-task",
				locale: NS,
				inject: () => ({ openMember: (id) => {
					openSession(ctx, id);
				} })
			}, UltraCodePanel));
		}
		//#endregion
		exports.UltraCodeSettings = UltraCodeSettings;
		exports.apply = apply;
		exports.inject = inject;
		exports.routeOptions = routeOptions;
		exports.ultraTaskDefinition = ultraTaskDefinition;
		return module.exports;
	}
});
