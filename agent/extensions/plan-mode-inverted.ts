/**
 * Inverted Plan/Build Posture — the centerpiece of The Augment harness.
 *
 * Forked and heavily trimmed from Pi's shipping `examples/extensions/plan-mode`.
 * The shipping example is an OPT-IN, read-only toggle (default OFF) that also
 * adds a whole "Claude-Code plan mode" workflow: plan-step extraction, an
 * execution mode, `[DONE:n]` progress tracking, a todo widget, and an end-of-run
 * menu. All of that is out of first-stage scope and is deliberately removed.
 *
 * What this keeps (and inverts):
 *   - Defaults to PLAN (read-only) on every session start.
 *   - `/plan` and `/build` switch modes within a session (separate commands, not
 *     one toggle). BUILD persists until `/plan` — one `/build` authorises a whole
 *     reviewable UNIT of work, not a single action.
 *   - Mutation is HARD-BLOCKED in PLAN, structurally (not advisory): non
 *     read-only tools are refused, and bash is restricted to a read-only
 *     allowlist (fail-closed: anything not recognised as safe is blocked).
 *   - A system-prompt block tells the model which mode it is in, every turn.
 *
 * Switching is operator-gated by construction: slash commands are typed by the
 * operator (the model cannot invoke them), and the tool_call block below denies
 * mutation in PLAN regardless of tool state.
 *
 * Verified against earendil-works/pi: pi.on("session_start"|"tool_call"|
 * "before_agent_start"), pi.setActiveTools/getAllTools, pi.registerCommand,
 * and before_agent_start returning { systemPrompt }. The bash patterns below are
 * taken verbatim from the shipping plan-mode `utils.ts` (`isSafeCommand`).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Mode = "plan" | "build";

/**
 * Tools allowed in PLAN. Read-only only. We intersect this with the tools the
 * running Pi build actually exposes (so an unknown name can never error), and we
 * also enforce it in the tool_call block below. `bash` is allowed here but is
 * further restricted to read-only commands.
 *
 * The brief's minimal set is ["read", "bash"]; grep/find/ls/todo/questionnaire
 * are read-only/non-mutating extras carried over from the upstream example to
 * keep planning useful. To run the strict minimal set, trim this to
 * ["read", "bash"].
 */
const PLAN_ALLOWLIST = ["read", "bash", "grep", "find", "ls", "todo", "questionnaire"];

// --- Read-only bash gate (verbatim from upstream plan-mode/utils.ts) ----------
// A command is allowed in PLAN only if it matches a read-only allowlist pattern
// AND matches none of the destructive patterns. Deny wins; unrecognised ⇒ blocked.
const DESTRUCTIVE_PATTERNS: RegExp[] = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

const SAFE_PATTERNS: RegExp[] = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*curl\s/i,
	/^\s*wget\s+-O\s*-/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*eza\b/,
];

function isReadOnlyCommand(command: string): boolean {
	const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
	const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
	return !isDestructive && isSafe;
}

// --- System-prompt block injected each turn ----------------------------------
function modeSystemBlock(mode: Mode): string {
	if (mode === "plan") {
		return [
			"## Current posture: PLAN (read-only)",
			"",
			"You are in PLAN mode — a read-only research and planning mode.",
			"- You MAY: read files and run read-only shell commands.",
			"- You MAY NOT: edit or write files, or run any command that changes the",
			"  system. These are structurally blocked — do not attempt them.",
			"- Produce a clear, plain-language plan the operator can review as a unit",
			"  of work. Do not make changes. Do not repeatedly ask to switch modes;",
			"  present the plan and wait.",
			"- Only the operator can switch to BUILD (via /build).",
		].join("\n");
	}
	return [
		"## Current posture: BUILD (changes enabled)",
		"",
		"You are in BUILD mode — the operator has authorised one reviewable unit of",
		"work.",
		"- Implement the agreed plan in small, logical steps.",
		"- Commit small and often with clear, plain-language messages.",
		"- When the unit of work is complete, stop for review. The operator returns",
		"  you to read-only with /plan.",
	].join("\n");
}

export default function invertedPlanMode(pi: ExtensionAPI): void {
	let mode: Mode = "plan";

	// PLAN: the read-only allowlist, intersected with tools this build exposes.
	function planTools(): string[] {
		const available = new Set(pi.getAllTools().map((t) => t.name));
		return PLAN_ALLOWLIST.filter((name) => available.has(name));
	}

	// BUILD: full access — every tool the build exposes (keeps todo etc. alive).
	function buildTools(): string[] {
		return pi.getAllTools().map((t) => t.name);
	}

	function applyMode(ctx: ExtensionContext, next: Mode): void {
		mode = next;
		pi.setActiveTools(next === "plan" ? planTools() : buildTools());

		if (!ctx.hasUI) return;
		if (next === "plan") {
			ctx.ui.setStatus("posture", ctx.ui.theme.fg("warning", "⏸ PLAN (read-only)"));
			ctx.ui.notify("PLAN mode: read-only research & planning. Use /build to authorise changes.", "info");
		} else {
			ctx.ui.setStatus("posture", ctx.ui.theme.fg("accent", "🔨 BUILD (changes enabled)"));
			ctx.ui.notify("BUILD mode: changes enabled for this unit of work. Use /plan to return to read-only.", "info");
		}
	}

	// Inverted default: every session starts in PLAN.
	pi.on("session_start", async (_event, ctx) => {
		applyMode(ctx, "plan");
	});

	// Operator-gated mode switches.
	pi.registerCommand("plan", {
		description: "Switch to PLAN mode (read-only research / planning)",
		handler: async (_args, ctx) => applyMode(ctx, "plan"),
	});
	pi.registerCommand("build", {
		description: "Switch to BUILD mode (authorise changes for one unit of work)",
		handler: async (_args, ctx) => applyMode(ctx, "build"),
	});

	// Hard structural block: refuse mutation while in PLAN.
	pi.on("tool_call", async (event) => {
		if (mode !== "plan") return;

		if (event.toolName === "bash") {
			const command = String(event.input.command ?? "");
			if (!isReadOnlyCommand(command)) {
				return {
					block: true,
					reason: `PLAN mode allows only read-only bash. Blocked command:\n  ${command}\nAsk the operator to /build first if this change is needed.`,
				};
			}
			return;
		}

		if (!PLAN_ALLOWLIST.includes(event.toolName)) {
			return {
				block: true,
				reason: `PLAN mode is read-only — the '${event.toolName}' tool is blocked. Ask the operator to /build first if this change is needed.`,
			};
		}
	});

	// Tell the model which mode it is in, every turn.
	pi.on("before_agent_start", async (event) => {
		return { systemPrompt: `${event.systemPrompt}\n\n${modeSystemBlock(mode)}` };
	});
}
