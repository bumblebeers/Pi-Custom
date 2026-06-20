# BUILD_LOG

A running journal of the harness build — one entry per work session. This is the
build's narrative in plain language: what was done, what was decided, what's next.
(For projects *using* the harness, the equivalent file is `PROJECT_LOG.md`; this
`BUILD_LOG.md` is specifically the journal of building the harness itself.)

---

## 2026-06-20 — First-stage build (web)

**Goal:** produce the first-stage harness artifacts in this config repo, per the
Hand-off Brief and Design Reference. No running or testing — that is the
operator's local step.

### Verified against actual Pi source (not memory)

The Hand-off Brief requires verifying every Pi mechanism against real source. The
Pi reference source was **not present in this repo** (it shipped empty: just
`LICENSE` + a one-line `README.md`). With the operator's agreement, verification
was done against the upstream `earendil-works/pi` via Context7 and the repo's raw
files. Confirmed:

- **Extension shape:** `export default function (pi: ExtensionAPI) { ... }`.
- **Events:** `pi.on("session_start" | "tool_call" | "before_agent_start", …)`.
- **Blocking:** a `tool_call` handler returning `{ block: true, reason }` refuses
  the call. `event.toolName` is `"read" | "bash" | "edit" | "write" | …`;
  `event.input` holds the (typed) parameters.
- **Tool gating:** `pi.getAllTools()` → metadata incl. `.name`;
  `pi.getActiveTools()` → active names; `pi.setActiveTools([...])` replaces the
  active set (system prompt auto-rebuilds on change).
- **Commands:** `pi.registerCommand("name", { description, handler })` →
  `/name`. Commands are **operator-typed**; the model cannot invoke them.
- **System prompt:** `before_agent_start` may return
  `{ systemPrompt: event.systemPrompt + "…" }` to append at the system-prompt
  layer for the turn (chained across extensions).
- **`models.json`:** `{ providers: { <name>: { baseUrl, api, apiKey, compat,
  models: [{ id }] } } }`; `api: "openai-completions"` for local/vLLM; `compat`
  flags incl. `maxTokensField`, `supportsDeveloperRole`, `thinkingFormat`
  (`"qwen"` exists); `thinkingLevelMap` (`null` hides a level). Lives at
  `~/.pi/agent/models.json`.
- **Extension loading:** files in `~/.pi/agent/extensions/` are auto-discovered
  on startup (also `--extension`/`-e`, or the `extensions` key in
  `settings.json`).
- **Read-only bash:** the shipping plan-mode defines `isSafeCommand` via a
  destructive-pattern denylist + read-only allowlist (deny wins; unknown ⇒
  blocked). This is the source of the bash gate in `plan-mode-inverted.ts`.

### Key decisions & divergences (so they show up in review)

1. **`pi-custom` is the config repo.** The repo was empty; this matches the
   design's "config repo is its own git repo, separate from the Pi fork."
   Deliverables that deploy live under `agent/`.
2. **Stripped the shipping plan-mode down to the posture.** The upstream
   `plan-mode` is a richer "Claude-Code plan mode" (plan-step extraction,
   execution mode, `[DONE:n]` tracking, progress widget, an `agent_end` menu).
   Those are out of first-stage scope, so `plan-mode-inverted.ts` keeps only:
   default-PLAN, `/plan` + `/build`, tool gating, the bash guard, and a
   system-prompt block.
3. **Inverted default + explicit commands.** Starts in PLAN on every
   `session_start`; `/plan` and `/build` switch within a session; BUILD persists
   until `/plan` (one `/build` = one reviewable unit of work).
4. **Operator-gated switching** is enforced two ways: slash commands are
   operator-typed (the model can't call them), and the `tool_call` hook blocks
   mutation in PLAN regardless of tool state.
5. **PLAN uses a read-only allowlist** (`read`, `bash`, plus `grep`/`find`/`ls`/
   `todo`/`questionnaire` *if the build exposes them*), intersected with
   available tools so unknown names can't error. **BUILD = all available tools**
   (so `todo` and future tools survive the switch). The brief's literal minimal
   set is `["read","bash"]`; the read-only extras follow the upstream source and
   are easy to trim — see the comment at the top of the extension.
6. **System-prompt block via `before_agent_start`** (append to
   `event.systemPrompt`), not message-injection — simpler and reflects the
   current mode each turn with no stale-state cleanup.
7. **`protected-paths` configured** to write-protect the steering files. Known
   limitation: it guards the `edit`/`write` tools only, so in BUILD mode a `bash`
   command could still touch a protected file. PLAN blocks mutating bash already;
   a bash-aware guard is deliberately *not* built (would need fragile shell
   parsing — flagged, not implemented).
8. **`dirty-repo-guard.ts` and `todo.ts` are faithful upstream copies** (provenance
   noted in each header). Because they track the upstream API, re-copy them from
   your own Pi version's `examples/extensions/` if a future Pi release changes
   their API. `plan-mode-inverted.ts` and `protected-paths.ts` are ours.

### Built this session

- Repo scaffold + `README.md` (layout + deploy model).
- `agent/AGENTS.md` (global standing brief) and `agent/APPEND_SYSTEM.md`.
- `agent/extensions/plan-mode-inverted.ts` (centerpiece).
- `agent/extensions/protected-paths.ts` (configured), `dirty-repo-guard.ts`,
  `todo.ts`.
- `agent/models.json` + `agent/settings.json` (Qwen placeholders).
- `templates/PROJECT_LOG.md` + README note.
- `LOCAL-DEPLOY-CHECKLIST.md`.

### Flagged, NOT built (deferred by design)

`read_url`/web extraction, sub-agents, a separate scratchpad, scheduling, richer
memory, and a `qwen-sampling` extension (redundant — vLLM applies the model's
shipped sampling defaults). If any becomes necessary, raise it; don't add it
speculatively.

### Next (operator, local)

Follow `LOCAL-DEPLOY-CHECKLIST.md`: install Pi + Node in a toolbox/Distrobox
container on Fedora Silverblue, deploy `agent/` to `~/.pi/agent/`, fill the
placeholders, confirm `AGENTS.md` stacks, confirm PLAN blocks an `edit`/`write`
and `/build` enables it, then run the first validation task.
