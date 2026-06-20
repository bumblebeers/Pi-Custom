/**
 * Protected Paths — configured for The Augment harness.
 *
 * Blocks the `edit` and `write` tools from touching steering files and other
 * sensitive paths. This is the structural half of the "AGENTS.md is read-only
 * steering" rule: the agent is told not to edit its own instructions, and this
 * makes sure it cannot.
 *
 * Mechanism is unchanged from Pi's shipping `examples/extensions/protected-paths`;
 * only the path list below is configured. Matching is a simple substring test
 * against the target path, so a bare filename like "AGENTS.md" protects that file
 * at every level (global and per-project).
 *
 * KNOWN LIMITATION: this guards the edit/write TOOLS only. A `bash` command (e.g.
 * `echo >> AGENTS.md`) is not inspected here. In PLAN mode that is moot — the
 * plan-mode extension already blocks all mutating bash. The gap is only in BUILD
 * mode, where the operator has explicitly authorised changes. A bash-aware guard
 * would need fragile shell parsing and is intentionally not built (flagged in
 * BUILD_LOG.md instead).
 *
 * NOTE: PROJECT_LOG.md and BUILD_LOG.md are deliberately NOT protected — they are
 * the agent's writable memory/journal.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const protectedPaths = [
		// Human-authored steering (global + per-project). Read-only to the agent.
		"AGENTS.md",
		"APPEND_SYSTEM.md",
		"SYSTEM.md",

		// Harness configuration and secrets.
		"models.json",
		"settings.json",
		"auth.json",

		// Universally sensitive (kept from the upstream defaults).
		".env",
		".git/",
		"node_modules/",

		// --- Project design docs / raw data --------------------------------------
		// Customise per your project layout. Substring matches, so keep these
		// distinctive. Examples (edit or extend to match where your projects keep
		// authored design and immutable inputs):
		"/design/",
		"/data/raw/",
		"raw-data/",
	];

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") {
			return undefined;
		}

		const path = event.input.path as string;
		const isProtected = protectedPaths.some((p) => path.includes(p));

		if (isProtected) {
			if (ctx.hasUI) {
				ctx.ui.notify(`Blocked write to protected path: ${path}`, "warning");
			}
			return {
				block: true,
				reason: `Path "${path}" is protected. If this file genuinely needs to change, the operator should edit it directly.`,
			};
		}

		return undefined;
	});
}
