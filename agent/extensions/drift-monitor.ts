/**
 * Drift Monitor (Build Ledger item 5) — fidelity forcing-framework. SCAFFOLD.
 *
 * A parallel, fresh-context check of the agent's trajectory against an agreed
 * specification, surfaced advisorily. The insight (same as the formalization
 * gate): an external checker with uncontaminated attention beats trusting the
 * main agent to notice its own drift as its context fills (context rot).
 *
 * Mechanism (verified against earendil-works/pi v0.79.9): extensions have NO
 * in-process model-call API. The feasible route — used by Pi's own subagent
 * example — is to spawn a `pi` subprocess (`pi -p --mode json --no-session`) via
 * pi.exec and read the final `message_end` from its JSON-lines stdout. That is
 * what this does. So the monitor's context is genuinely fresh (a new process),
 * carrying only the spec + a short trajectory summary.
 *
 * Design intent honoured here: advisory/surfaced output, never authoritative
 * auto-correction; it asks the checker to distinguish UNEXPLAINED drift from
 * REASONED deviation; and it re-seats the spec at the END of the main context
 * (the recency zone the model still attends to) rather than only alarming.
 *
 * STATUS: scaffold — mechanism verified against source, NOT executed/tested.
 * Disabled by default (ENABLED=false): it is a prototype and it taxes decode
 * throughput. Enable only deliberately.
 *
 * OPEN DESIGN QUESTIONS / BLOCKERS (see STATUS.md) — these are real and belong to
 * the design conversation, not a silent guess:
 *   1. SPEC SOURCE: what file holds "the agreed spec"? Defaulted to SPEC.md; the
 *      harness has no spec-capture convention yet (the approved plan? a SPEC.md
 *      the operator writes? the current PROJECT_LOG task?). Decide and set SPEC_FILE.
 *   2. EXECUTION-GROUNDED VERDICT: the strongest form runs the spec's own checks
 *      (tests). But the monitor worker re-loads this overlay and starts in
 *      read-only PLAN, where the bash allowlist blocks test runners (npm test,
 *      pytest, …). So execution-grounding needs a design decision (a dedicated
 *      verify mode, a sandboxed build worker, or an allowlist for test commands).
 *      This scaffold ships a READING verdict only.
 *   3. THROUGHPUT: parallel calls are free in dollars, not in decode budget. WHERE
 *      it runs (MONITOR_MODEL — a smaller/secondary model) and WHEN it fires
 *      (CADENCE) are operator-cluster-specific and left as config, not assumed.
 *   4. TRAJECTORY CAPTURE: summarising "recent actions" from the read-only
 *      session manager is version-sensitive and approximate here; refine once the
 *      session entry shape is pinned for the operator's Pi version.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// --- Configurable parameters (no operator-specific assumptions baked in) ------
const ENABLED = false; // opt-in: a prototype that taxes throughput. Flip on deliberately.
const SPEC_FILE = "SPEC.md"; // file holding the agreed spec (OPEN QUESTION #1)
const CADENCE = 1; // run the monitor every Nth agent_end checkpoint
const MONITOR_MODEL: string | undefined = undefined; // e.g. a smaller/secondary model id; undefined = worker default
const WORKER_TOOLS = ["read", "grep", "find", "ls"]; // reading verdict (see OPEN QUESTION #2)
const RECENT_ENTRIES = 12; // how many recent session entries to summarise as the trajectory
const MAX_SPEC_BYTES = 8 * 1024;
const MAX_TRAJ_BYTES = 6 * 1024;
const WORKER_TIMEOUT_MS = 5 * 60 * 1000;

function clamp(s: string, n: number): string {
	return s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s;
}

function piInvocation(extra: string[]): { command: string; args: string[] } {
	const script = process.argv[1];
	const isVirtual = script?.startsWith("/$bunfs/");
	if (script && !isVirtual) return { command: process.execPath, args: [script, ...extra] };
	const exe = basename(process.execPath).toLowerCase();
	return /^(node|bun)(\.exe)?$/.test(exe) ? { command: "pi", args: extra } : { command: process.execPath, args: extra };
}

function readSpec(cwd: string): { path: string; text: string } | undefined {
	for (const p of [join(cwd, SPEC_FILE)]) {
		if (existsSync(p)) {
			try {
				return { path: p, text: clamp(readFileSync(p, "utf-8"), MAX_SPEC_BYTES) };
			} catch {
				/* unreadable */
			}
		}
	}
	return undefined;
}

// Approximate trajectory summary from the read-only session manager (see #4).
function summariseTrajectory(ctx: ExtensionContext): string {
	try {
		const entries = ctx.sessionManager.getEntries() as Array<Record<string, unknown>>;
		const recent = entries.slice(-RECENT_ENTRIES);
		const lines: string[] = [];
		for (const e of recent) {
			const msg = e.message as { role?: string; content?: unknown; toolName?: string } | undefined;
			if (!msg) continue;
			if (msg.toolName) {
				lines.push(`- tool: ${msg.toolName}`);
			} else if (typeof msg.content === "string") {
				lines.push(`- ${msg.role ?? "msg"}: ${msg.content.slice(0, 200)}`);
			} else if (Array.isArray(msg.content)) {
				const text = msg.content
					.filter((b): b is { type: string; text: string } => !!b && (b as { type?: string }).type === "text")
					.map((b) => b.text)
					.join(" ");
				if (text) lines.push(`- ${msg.role ?? "msg"}: ${text.slice(0, 200)}`);
			}
		}
		return clamp(lines.join("\n"), MAX_TRAJ_BYTES);
	} catch {
		return "(could not read session trajectory)";
	}
}

function monitorTask(spec: string, trajectory: string): string {
	// Stable spec FIRST (cacheable prefix), changing trajectory LAST.
	return [
		"You are a drift monitor with fresh, uncontaminated context. You are NOT here",
		"to implement anything — only to judge whether the main agent's recent work is",
		"still tracking the agreed specification.",
		"",
		"=== AGREED SPECIFICATION (stable) ===",
		spec,
		"",
		"=== MAIN AGENT'S RECENT ACTIONS (most recent last) ===",
		trajectory,
		"",
		"=== YOUR JUDGEMENT ===",
		"Decide which applies and reply on a single line, then one line of reason:",
		"- ON-TRACK: the work matches the spec.",
		"- REASONED-DEVIATION: the work departs from the spec, but for a defensible",
		"  reason (e.g. the spec was wrong). Drift is not always error.",
		"- UNEXPLAINED-DRIFT: the work has wandered from the spec with no stated reason.",
		"Format exactly: 'VERDICT: <one of the three> — <short reason>'.",
	].join("\n");
}

function finalMessage(stdout: string): string {
	let out = "";
	for (const line of stdout.split("\n")) {
		const t = line.trim();
		if (!t) continue;
		try {
			const ev = JSON.parse(t) as { type?: string; message?: { content?: unknown } };
			if (ev.type === "message_end" && ev.message) {
				const c = ev.message.content;
				if (typeof c === "string") out = c;
				else if (Array.isArray(c)) {
					out = c
						.filter((b): b is { type: string; text: string } => !!b && (b as { type?: string }).type === "text")
						.map((b) => b.text)
						.join("\n");
				}
			}
		} catch {
			/* ignore non-JSON */
		}
	}
	return out.trim();
}

export default function driftMonitor(pi: ExtensionAPI): void {
	// Guards: never run inside a worker subprocess (workers use --no-session), and
	// do nothing unless explicitly enabled.
	if (process.argv.includes("--no-session")) return;
	if (!ENABLED) return;

	let checkpoints = 0;
	let pendingVerdict: string | undefined;

	// Checkpoint: after the main agent finishes a run (idle), run a fresh-context check.
	pi.on("agent_end", async (_event, ctx) => {
		checkpoints += 1;
		if (checkpoints % CADENCE !== 0) return;

		const spec = readSpec(ctx.cwd);
		if (!spec) return; // nothing to check against yet (see OPEN QUESTION #1)

		const trajectory = summariseTrajectory(ctx);
		const extra = ["-p", "--mode", "json", "--no-session", "--tools", WORKER_TOOLS.join(",")];
		if (MONITOR_MODEL) extra.push("--model", MONITOR_MODEL);
		extra.push(`Task: ${monitorTask(spec.text, trajectory)}`);

		try {
			const inv = piInvocation(extra);
			const r = await pi.exec(inv.command, inv.args, { timeout: WORKER_TIMEOUT_MS });
			if (r.code !== 0) return;
			const verdict = finalMessage(r.stdout);
			if (!verdict) return;
			pendingVerdict = verdict;
			if (ctx.hasUI && /UNEXPLAINED-DRIFT/i.test(verdict)) {
				ctx.ui.notify(`Drift monitor: ${verdict}`, "warning");
			}
		} catch {
			// monitor is best-effort and advisory; never disrupt the main loop
		}
	});

	// Re-seat the spec + verdict at the END of context (recency zone), advisory only.
	pi.on("before_agent_start", async (event) => {
		if (!pendingVerdict) return;
		const block = [
			"## Drift monitor (advisory — a fresh-context check, not authoritative)",
			pendingVerdict,
			"If this is a REASONED-DEVIATION you stand by, continue and note why. If it is",
			"UNEXPLAINED-DRIFT, re-read the spec and realign. This is advice, not a command.",
		].join("\n");
		pendingVerdict = undefined; // surface once
		return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
	});
}
