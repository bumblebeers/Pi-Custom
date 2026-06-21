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
 * This pass adds two fidelity frameworks (Build Ledger item 1):
 *   - A build PRE-FLIGHT: on the first turn of a default `/build`, inject the
 *     formalization checks in miniature so hard-blocking problems surface before
 *     implementation.
 *   - GRADUATED AUTONOMY: `/build` (pre-flight), `/build vetted` (skip pre-flight),
 *     `/build auto` (skip pre-flight and run to completion). Chosen per-invocation,
 *     never a sticky default; each level injects the rationale for why that much
 *     autonomy is appropriate.
 *
 * Switching is operator-gated by construction: slash commands are typed by the
 * operator (the model cannot invoke them), and the tool_call block below denies
 * mutation in PLAN regardless of tool state.
 *
 * Verified against earendil-works/pi (v0.79.9): pi.on("session_start"|"tool_call"|
 * "before_agent_start"), pi.setActiveTools/getAllTools, pi.registerCommand whose
 * handler receives `args: string` (text after the command), and before_agent_start
 * handlers CHAIN — each receives the prior handler's modified systemPrompt and the
 * cumulative result is applied (runner.ts emitBeforeAgentStart). The bash patterns
 * are taken verbatim from the shipping plan-mode `utils.ts` (`isSafeCommand`).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Mode = "plan" | "build";

/**
 * Build autonomy level — chosen PER-INVOCATION via `/build` arguments, never a
 * sticky global default (automation complacency is compound drift wearing a
 * different hat: the convenient bypass quietly becomes the habitual one).
 *   "checked"  /build         default: run the pre-flight on the first build turn.
 *   "vetted"   /build vetted  skip the pre-flight — operator already reviewed the plan.
 *   "full"     /build auto    skip the pre-flight AND run the task to completion.
 */
type Autonomy = "checked" | "vetted" | "full";

function parseAutonomy(args: string): Autonomy {
	const first = args.trim().toLowerCase().split(/\s+/)[0];
	if (first === "auto" || first === "full" || first === "yolo") return "full";
	if (first === "vetted" || first === "go" || first === "skip") return "vetted";
	return "checked";
}

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

// One-shot sanity check injected on the FIRST turn of a default `/build`.
// The formalization checks in miniature — catch hard-blocking problems before
// implementing, when fixing them is cheap.
function preflightBlock(): string {
	return [
		"## Build pre-flight — do this BEFORE implementing anything this turn",
		"",
		"Run a quick sanity check on the agreed plan (the formalization checks in",
		"miniature):",
		"- Grounding: does the plan rest on an unverified assumption or claim? If a",
		"  load-bearing fact isn't verified, verify it (or flag it) before building.",
		"- Fidelity: is what you're about to build exactly what was agreed? If you've",
		"  mentally reframed the request to make it neater, surface that reframing",
		"  instead of acting on it.",
		"- Falsifiability: how will you know the result is correct? Name the check.",
		"If you find a hard-blocking problem (an unverifiable assumption, a spec that",
		"cannot be satisfied as written, a scope mismatch), STOP and flag it in plain",
		"language instead of implementing. Otherwise, proceed. For a full evaluation,",
		"invoke /skill:formalization-gate.",
	].join("\n");
}

// Per-level autonomy rationale, injected each build turn. The rationale IS the
// point: the agent should understand why this much autonomy is appropriate.
function autonomyBlock(level: Autonomy): string {
	if (level === "vetted") {
		return [
			"## Autonomy: plan already vetted (pre-flight skipped)",
			"The operator confirmed the plan was already reviewed, so the pre-flight is",
			"skipped this time. Implement in small, reviewable steps. Re-checking an",
			"already-vetted plan is friction without augmentation — but still STOP and",
			"flag if you hit a genuinely hard-blocking problem.",
		].join("\n");
	}
	if (level === "full") {
		return [
			"## Autonomy: full — run to completion",
			"The operator has authorised this task for autonomous completion (a",
			"well-specified, recurring, or low-stakes task class). Work through the whole",
			"task without pausing for intermediate confirmation — forcing review on",
			"trivial or recurring work is friction, not augmentation.",
			"You remain human-on-the-loop, not human-removed: the diff, the logs, and the",
			"PROJECT_LOG entry are the review trail — keep them clean and write a clear",
			"PROJECT_LOG entry at the end. This autonomy is for THIS task only; it is not",
			"a new default. Still STOP and flag a genuinely hard-blocking problem.",
		].join("\n");
	}
	return ""; // "checked": no standing block; the one-shot pre-flight covers turn 1.
}

export default function invertedPlanMode(pi: ExtensionAPI): void {
	let mode: Mode = "plan";
	let autonomy: Autonomy = "checked";
	let preflightPending = false; // true ⇒ inject the pre-flight on the next build turn

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
			const label = autonomy === "full" ? "🔨 BUILD (full)" : autonomy === "vetted" ? "🔨 BUILD (vetted)" : "🔨 BUILD";
			ctx.ui.setStatus("posture", ctx.ui.theme.fg("accent", label));
			// The /build handler emits the autonomy-aware notification.
		}
	}

	// Inverted default: every session starts in PLAN.
	pi.on("session_start", async (_event, ctx) => {
		autonomy = "checked";
		preflightPending = false;
		applyMode(ctx, "plan");
	});

	// Operator-gated mode switches.
	pi.registerCommand("plan", {
		description: "Switch to PLAN mode (read-only research / planning)",
		handler: async (_args, ctx) => {
			autonomy = "checked";
			preflightPending = false;
			applyMode(ctx, "plan");
		},
	});
	pi.registerCommand("build", {
		description: "Switch to BUILD. Args: (none)=pre-flight first turn; 'vetted'=skip pre-flight; 'auto'=skip + run to completion",
		handler: async (args, ctx) => {
			autonomy = parseAutonomy(args);
			preflightPending = autonomy === "checked";
			applyMode(ctx, "build");
			if (ctx.hasUI) {
				const note =
					autonomy === "full"
						? "BUILD (full autonomy): will run to completion — review the diff/log after."
						: autonomy === "vetted"
							? "BUILD (plan vetted): pre-flight skipped. Use /plan to return to read-only."
							: "BUILD: a pre-flight sanity check runs on the first turn. Use /plan to return.";
				ctx.ui.notify(note, "info");
			}
		},
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

	// Tell the model which mode it is in, every turn. In BUILD, also inject the
	// autonomy rationale and (on the first build turn of a default /build) the
	// pre-flight. before_agent_start handlers chain, so this appends to whatever
	// other extensions have already added.
	pi.on("before_agent_start", async (event) => {
		let block = modeSystemBlock(mode);
		if (mode === "build") {
			const auto = autonomyBlock(autonomy);
			if (auto) block += `\n\n${auto}`;
			if (preflightPending) {
				block += `\n\n${preflightBlock()}`;
				preflightPending = false; // one-shot: first build turn only
			}
		}
		return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
	});
}
