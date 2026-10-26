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
		* The task heading, each member, and each outcome are separate log events, so
		* the node reproduces exactly what ran — including the model a child actually
		* used — instead of re-deriving routing from the tool call's arguments.
		*
		* @module @deepseek-ai/dsh-client-ui-ultracode/client
		*/
		function locationClosed(location) {
			if (location.kind === "step") return location.step.status === "closed" || location.turn.status === "closed";
			return location.kind === "turn" && location.turn.status === "closed";
		}
		function memberStatus(row, accepted) {
			if (accepted) return "accepted";
			return row.role === "validator" ? "rejected" : "failed";
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
				switch (event.type) {
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
				if (match.event.type !== "ultracode/task") throw new Error("ultracode-task start requires ultracode/task");
				return {
					label: match.event.data.label,
					mode: match.event.data.mode,
					members: []
				};
			},
			update: (context, match) => {
				if (match.event.type === "ultracode/member") {
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
				if (match.event.type === "ultracode/outcome") {
					const data = match.event.data;
					return {
						...context.state,
						members: context.state.members.map((row) => row.childId === data.childId ? {
							...row,
							status: memberStatus(row, data.accepted)
						} : row)
					};
				}
				if (match.event.type === "ultracode/task-end") return {
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
		//#region \0dsh-css:/home/absint0o/projects/dsh/packages/client/ui-ultracode/src/client/UltraCodePanel.module.css.mjs
		const css = ".SDUSsq_root{margin:8px 0;display:block}.SDUSsq_header{width:100%;min-height:28px;color:var(--dsh-text-primary);border-radius:6px;align-items:center;gap:6px;padding:0 6px;font-size:13px;display:flex}.SDUSsq_separator{background:var(--dsh-border-subtle);flex:none;width:1px;height:12px}.SDUSsq_summary{color:var(--dsh-text-muted);font-size:12px}.SDUSsq_statusTail{color:var(--dsh-text-muted);align-items:center;gap:4px;margin-left:auto;font-size:12px;display:inline-flex}.SDUSsq_members{flex-direction:column;gap:1px;padding:2px 0 2px 10px;display:flex}.SDUSsq_member{width:100%;min-height:24px;color:var(--dsh-text-primary);text-align:left;cursor:pointer;background:0 0;border:none;border-radius:6px;align-items:center;gap:6px;padding:0 6px;font-size:13px;display:flex}.SDUSsq_member:hover{background:var(--dsh-surface-hover)}.SDUSsq_dotSlot{flex:none;align-items:center;display:inline-flex}.SDUSsq_memberLabel{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.SDUSsq_memberMeta{color:var(--dsh-text-muted);white-space:nowrap;margin-left:auto;font-size:12px}.SDUSsq_empty{color:var(--dsh-text-muted);font-size:12px}";
		const tagId = "@deepseek-ai/dsh-client-ui-ultracode/UltraCodePanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-ultracode";
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
			accepted: "status.accepted",
			rejected: "status.rejected",
			failed: "status.failed"
		};
		function dotState(status) {
			switch (status) {
				case "running": return "ongoing";
				case "passed":
				case "accepted": return "done";
				case "failed":
				case "rejected": return "error";
			}
		}
		/**
		* One member row: the model the child actually ran on, its role, and its
		* round. The row is the control surface — clicking opens that child session,
		* where the transcript and the Stop control live.
		*/
		function MemberRow({ member, openMember, t }) {
			const name = member.model === "" ? member.childId : member.model;
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
							t(MEMBER_STATUS_KEYS[member.status])
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
			else content = task.members.map((member) => (0, react_jsx_runtime.jsx)(MemberRow, {
				member,
				openMember,
				t
			}, member.childId));
			return (0, react_jsx_runtime.jsx)("section", {
				className: UltraCodePanel_module_css_default.root,
				"data-ultracode-task": true,
				"data-task-status": task.status,
				children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {}),
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
		* working on each delegated task, and the header control that shows the task
		* count for the session.
		*
		* It reads only durable `ultracode/*` events, so what it shows is what ran.
		*
		* @module @deepseek-ai/dsh-client-ui-ultracode/client
		*/
		/** Required services for the task Definition, keyed renderer, and copy. */
		const inject = [
			"conversationEvents",
			"slots",
			"locale"
		];
		/** Register the UltraCode task Definition, dictionary, and keyed Chat renderer. */
		function apply(ctx) {
			ctx.conversationEvents.register(ultraTaskDefinition);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-ultracode: dictionaries");
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "ultracode-task",
				locale: NS,
				inject: () => ({ openMember: (id) => {
					ctx.sessions.open(id);
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

//# sourceMappingURL=client.js.map