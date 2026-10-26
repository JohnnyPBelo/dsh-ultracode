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
			"mode.frugal": "省钱模式"
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
			"mode.frugal": "Frugal"
		};
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
		exports.apply = apply;
		exports.inject = inject;
		exports.ultraTaskDefinition = ultraTaskDefinition;
		return module.exports;
	}
});
