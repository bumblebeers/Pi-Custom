/**
 * Sub-Agent Delegate (Build Ledger item 6) — lateral partitioning.
 *
 * A GENERAL example of offloading an INDEPENDENT, isolatable sub-task to a
 * fresh-context worker, to protect the main agent's judgment budget. This is NOT
 * a production tool for any domain (web extraction etc. is deferred) — it is the
 * reusable pattern. The task-scoping CRITERION (delegate on independence +
 * write-concurrency) is a taught design principle kept in AGENTS.md, not encoded.
 *
 * Mechanism (verified against earendil-works/pi v0.79.9): there is no native
 * subagent API; Pi's own subagent example spawns a `pi` subprocess. This uses
 * pi.exec to run `pi -p --mode json --no-session` (ephemeral, isolated context)
 * and parses the final `message_end` event from the JSON-lines stdout.
 *
 * STATUS: scaffold — mechanism verified against source, NOT executed/tested.
 *
 * KNOWN LIMITATIONS / design questions (see STATUS.md), all stemming from the
 * fact that a spawned worker re-loads this same global overlay:
 *   - The worker inherits plan-mode's read-only PLAN default and has no operator
 *     to `/build`, so delegation is effectively READ-ONLY. That happens to match
 *     the safe read/write boundary (single-threaded writes stay with the main
 *     agent), but it means a *writing* worker needs a design decision (e.g. a
 *     build-by-default flag for headless workers).
 *   - Whether Pi can spawn a subprocess that skips the global extensions entirely
 *     (so workers aren't gated and truly can't recurse) is unverified — flagged.
 *     Until then, the guard below uses the presence of `--no-session` to disable
 *     this tool inside workers.
 */

import { basename } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_WORKER_TOOLS = ["read", "grep", "find", "ls"]; // read-only by default
const WORKER_TIMEOUT_MS = 10 * 60 * 1000;

// Resolve how to invoke pi as a subprocess (mirrors the shipping subagent example).
function piInvocation(extra: string[]): { command: string; args: string[] } {
	const script = process.argv[1];
	const isVirtual = script?.startsWith("/$bunfs/");
	if (script && !isVirtual) return { command: process.execPath, args: [script, ...extra] };
	const exe = basename(process.execPath).toLowerCase();
	return /^(node|bun)(\.exe)?$/.test(exe) ? { command: "pi", args: extra } : { command: process.execPath, args: extra };
}

// Pull the worker's final assistant message out of the JSON-lines stdout.
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
			// non-JSON line — ignore
		}
	}
	return out;
}

export default function subagentDelegate(pi: ExtensionAPI): void {
	// Recursion guard: don't offer delegation inside an ephemeral worker subprocess
	// (workers run with --no-session), or a worker could spawn workers without end.
	if (process.argv.includes("--no-session")) return;

	pi.registerTool({
		name: "delegate",
		label: "Delegate",
		description:
			"Delegate an INDEPENDENT, self-contained sub-task to a fresh-context worker (a separate ephemeral pi process). Use for isolatable work — large reading/summarisation, well-specified transformations — to protect the main context's judgment budget. Do NOT use for work needing the evolving shared context, or that writes files other work depends on (parallel writes over shared state are unsafe). The worker sees only the task you give it and returns only its final answer.",
		parameters: Type.Object({
			task: Type.String({
				description:
					"A complete, self-contained instruction. The worker sees ONLY this — not the conversation — so include everything it needs.",
			}),
			tools: Type.Optional(
				Type.Array(Type.String(), {
					description: "Worker tool allowlist. Defaults to read-only (read, grep, find, ls).",
				}),
			),
		}),
		async execute(_id, params, signal, _onUpdate, _ctx) {
			const tools = (params.tools?.length ? params.tools : DEFAULT_WORKER_TOOLS).join(",");
			const inv = piInvocation(["-p", "--mode", "json", "--no-session", "--tools", tools, `Task: ${params.task}`]);
			const r = await pi.exec(inv.command, inv.args, { signal, timeout: WORKER_TIMEOUT_MS });
			if (r.code !== 0) {
				return {
					content: [{ type: "text", text: `Delegate worker failed (exit ${r.code}).\n${r.stderr.slice(0, 2000)}` }],
					details: {},
				};
			}
			return {
				content: [{ type: "text", text: finalMessage(r.stdout) || "(worker returned no final message)" }],
				details: {},
			};
		},
	});
}
