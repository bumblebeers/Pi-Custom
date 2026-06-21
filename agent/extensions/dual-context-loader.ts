/**
 * Dual-Context Auto-Loader (Build Ledger item 2)
 *
 * Pi natively auto-loads the WRITE-PROTECTED steering file (AGENTS.md) into the
 * system prompt. This extension loads the other half of the per-directory dual
 * context: a designated AGENT-WRITABLE memory file (default NOTES.md), so the
 * agent's own notes-to-self are present in context the way AGENTS.md is.
 *
 * Scoped against bloat: writable files grow where steering files stay terse, so
 * this loads only the NEAREST file (searching cwd upward) PLUS the WORKSPACE ROOT
 * file — not the entire ancestor chain — and clamps each file's size. (Native
 * AGENTS.md uses the full chain; the writable half is deliberately narrower.)
 *
 * The writable file is intentionally NOT write-protected — protected-paths guards
 * AGENTS.md/APPEND_SYSTEM.md, never this file.
 *
 * Mechanism (verified against earendil-works/pi v0.79.9): there is no
 * addContextFile API, and mutating systemPromptOptions.contextFiles inside
 * before_agent_start is inert (the prompt is already built; only a returned
 * `systemPrompt` string is applied). The supported path is to read the file(s)
 * and append to event.systemPrompt — and before_agent_start handlers CHAIN, so
 * this composes with the plan-mode block. Node's fs/path and pi.exec are both
 * available to extensions (the shipping subagent example uses node:child_process
 * and fs). Workspace root is the git toplevel via exec, falling back to cwd.
 *
 * OPEN DESIGN QUESTION (flagged, not decided — see STATUS.md): whether this
 * writable file should be a distinct NOTES.md (terse current working memory,
 * loaded every turn) or unified with PROJECT_LOG.md (the chronological session
 * log, which is meant to grow and would bloat context if loaded whole). Default
 * here is a distinct NOTES.md; change MEMORY_FILENAME if the design unifies them.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// --- Configurable parameters (no operator-specific assumptions) --------------
const MEMORY_FILENAME = "NOTES.md"; // the agent-writable per-directory memory file
const MAX_BYTES_PER_FILE = 16 * 1024; // bloat guard: clamp an oversized notes file

async function workspaceRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
	try {
		const r = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
		const top = r.stdout.trim();
		if (r.code === 0 && top) return top;
	} catch {
		// not a git repo, or git unavailable — fall back to cwd
	}
	return cwd;
}

// Nearest MEMORY_FILENAME searching cwd upward, stopping at (and including) root.
function nearestMemoryFile(cwd: string, root: string): string | undefined {
	let dir = cwd;
	for (;;) {
		const candidate = join(dir, MEMORY_FILENAME);
		if (existsSync(candidate)) return candidate;
		if (dir === root) break;
		const parent = dirname(dir);
		if (parent === dir) break; // reached filesystem root
		dir = parent;
	}
	return undefined;
}

function readClamped(path: string): string {
	const text = readFileSync(path, "utf-8");
	if (text.length > MAX_BYTES_PER_FILE) {
		return `${text.slice(0, MAX_BYTES_PER_FILE)}\n…[truncated: ${MEMORY_FILENAME} exceeds ${MAX_BYTES_PER_FILE} bytes — keep it terse]`;
	}
	return text;
}

export default function dualContextLoader(pi: ExtensionAPI): void {
	pi.on("before_agent_start", async (event, ctx) => {
		const cwd = ctx.cwd;
		const root = await workspaceRoot(pi, cwd);

		// Scoped against bloat: nearest + workspace root only (dedup if the same).
		const paths: string[] = [];
		const nearest = nearestMemoryFile(cwd, root);
		if (nearest) paths.push(nearest);
		const rootFile = join(root, MEMORY_FILENAME);
		if (existsSync(rootFile) && !paths.includes(rootFile)) paths.push(rootFile);
		if (paths.length === 0) return;

		const sections = paths
			.map((p) => {
				try {
					return `<writable_notes path="${p}">\n${readClamped(p)}\n</writable_notes>`;
				} catch {
					return "";
				}
			})
			.filter(Boolean);
		if (sections.length === 0) return;

		const block = [
			"## Your writable notes (agent-authored memory)",
			"",
			`These ${MEMORY_FILENAME} files are YOUR memory to maintain — you may edit them`,
			"(unlike the write-protected AGENTS.md steering). Keep them terse: they load",
			"every turn, and only the nearest file and the workspace-root file are shown.",
			"",
			sections.join("\n\n"),
		].join("\n");

		return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
	});
}
