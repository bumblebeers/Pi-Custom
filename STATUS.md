# STATUS — Implementation Pass (2026-06-21)

This pass worked the Build Ledger from *Human–AI Collaboration in The Augment*.
It is a **checkpoint**: implement what's clearly buildable, prototype the
feasible-but-uncertain, and document blockers precisely so the design
conversation can resolve them.

## Provenance (read this first)

- **Verified-against-source:** every Pi mechanism cited below was checked against
  the actual `earendil-works/pi` source at **v0.79.9** (the relevant files:
  `src/core/extensions/types.ts`, `system-prompt.ts`, `resource-loader.ts`,
  `skills.ts`, `cli/args.ts`, `extensions/runner.ts`, and the `subagent` example).
  The Pi source is **not** in this repo, so it was read from the upstream repo.
- **Tested:** **nothing was executed.** There is no Pi runtime, model endpoint, or
  host in this environment. No extension here has been run. "Verified" means
  "matches the source," **not** "observed working."
- The operator's local validation (see end + `LOCAL-DEPLOY-CHECKLIST.md`) is the
  external contact that turns "verified" into "works."
- **Public-safe audit:** the repo carries no operator-specific content. Steering
  files speak of "the operator" generically; `models.json`/`settings.json` are
  `REPLACE_ME` placeholders; hardware/throughput specifics are config constants,
  not hard-coded. (Minor open question below: rename the config files to
  `.example`?)

---

## Done (built + verified against source; not runtime-tested)

**Item 1 — plan/build pre-flight + graduated autonomy** (`agent/extensions/plan-mode-inverted.ts`).
A one-shot build **pre-flight** (formalization checks in miniature) injected on
the first turn of a default `/build`; **graduated autonomy** via `/build` args
(`/build` = pre-flight, `/build vetted` = skip it, `/build auto` = skip + run to
completion), each injecting its rationale; per-invocation, never sticky.
*Verified:* `registerCommand` handlers receive `args: string`; `before_agent_start`
handlers **chain** their `systemPrompt` edits (confirmed in `runner.ts`
`emitBeforeAgentStart`). *Caveat:* "run to completion" is a prompt-level signal —
see design question 7.

**Item 2 — dual-context auto-loader** (`agent/extensions/dual-context-loader.ts`).
Auto-loads an agent-writable `NOTES.md` (nearest + workspace-root only, size-clamped)
by appending to `event.systemPrompt`. *Verified:* there is **no** `addContextFile`
API and mutating `contextFiles` in `before_agent_start` is inert, so append-to-
systemPrompt is the supported path; git root via `pi.exec`. Stays writable
(protected-paths guards `AGENTS.md`, not this). See design question 1.

**Item 3 — SYSTEM.md inventory + draft** (`docs/system-prompt-inventory.md`,
`agent/SYSTEM.draft.md`). Required inventory done against source: the custom-prompt
branch **drops** `toolsList` + guidelines but still appends `APPEND_SYSTEM.md`,
`AGENTS.md`, the skills list, and date/cwd; tool *schemas* are always sent. Draft
replaces the persona and reintroduces file-handling scaffolding only. **Shipped
inert** (`SYSTEM.draft.md`, not the active `SYSTEM.md`) because the keep/drop calls
are consequential — see design question 2.

**Item 4 — formalization-gate skill** (`agent/skills/formalization-gate/SKILL.md`).
Ported the existing procedure to Pi's native skills system. *Verified:* Pi supports
the Claude-Code `SKILL.md` format (`name`+`description` frontmatter, `description`
≤1024 chars), discovered from `~/.pi/agent/skills/<name>/SKILL.md`, both
model-invocable (listed in-prompt) and user-invocable (`/skill:formalization-gate`).
Body unchanged; description tightened to the limit.

---

## Prototyped (mechanism verified; shipped as scaffolds; not runtime-tested)

**Item 6 — sub-agent delegate** (`agent/extensions/subagent-delegate.ts`).
A general `delegate` tool that runs an independent sub-task in a fresh-context
worker. *Verified mechanism:* no native subagent API exists; Pi's own example
spawns `pi -p --mode json --no-session` — this does the same via `pi.exec` and
parses `message_end`. Read-only worker tools by default; recursion-guarded.
*Limitation (real):* a spawned worker re-loads this overlay and starts in read-only
PLAN with no operator to `/build`, so delegation is **effectively read-only** —
which matches the safe read/write boundary but blocks writing workers. See design
question 5.

**Item 5 — drift monitor** (`agent/extensions/drift-monitor.ts`, **disabled by
default**). Fresh-context check of the trajectory vs an agreed spec, advisory only,
re-seating the spec into the recency zone; distinguishes unexplained drift from
reasoned deviation. *Verified mechanism:* same subprocess route (extensions have no
in-process model call). Shipped as a configurable scaffold (spec source, cadence,
monitor model, worker tools are all config constants). See design questions 3–6.

---

## Blocked / constrained (the specific blockers)

1. **No in-process model call for extensions** (verified). `ExtensionAPI` /
   `ExtensionContext` expose no `complete`/`query`/`stream`/`sample`. Consequence:
   the drift monitor and any sub-agent must shell out to a `pi` subprocess (or use
   the SDK to build a separate session — not available through the extension `pi`
   object). *Not fully blocked* — the subprocess route works and is what Pi's own
   subagent example uses — but it shapes items 5 and 6 and is the reason both are
   subprocess-based.

2. **Execution-grounded drift verdict is blocked** by an interaction: the monitor
   worker re-loads this overlay and starts in read-only PLAN, whose bash allowlist
   blocks test runners (`npm test`, `pytest`, …). So the strongest ("run the spec's
   checks") form can't run as-is. The scaffold ships a *reading* verdict only.
   Needs a design decision (design question 4).

3. **Writing sub-agents are blocked** by the same read-only-PLAN-in-worker
   interaction (a worker has no operator to `/build`). Fine for the safe
   read-only/reading default; a decision is needed to enable writing workers
   (design question 5).

4. **Unverified:** whether Pi can spawn a subprocess that **skips the global
   overlay** (so workers run clean — no plan-mode gating, no recursion risk). I did
   not find a `--no-extensions`-style flag; the recursion guard here is a
   workaround (disable monitor/delegate when `--no-session` is present). This needs
   a source check or an upstream feature (design question 5).

---

## Remaining (not done, by reason)

- **Activating `SYSTEM.md`** — deliberately left as a draft pending the keep/drop
  decisions (design question 2). Rename `SYSTEM.draft.md` → `SYSTEM.md` and add to
  the deploy list once resolved.
- **`NOTES.md` template** — not shipped pending the NOTES-vs-PROJECT_LOG decision
  (design question 1). Trivial to add once decided.
- **Tuning the drift monitor** for the operator's cluster (model, cadence,
  throughput) — needs the operator's hardware parameters (kept as config, not
  assumed).
- **Tool-guideline wording in `SYSTEM.draft.md`** is based on v0.79.9; reconfirm
  against the operator's Pi version (design question 2).

---

## Design questions to resolve (bring these back)

1. **NOTES.md vs PROJECT_LOG.md** — distinct files (terse auto-loaded working
   memory vs growing chronological log, as built), or unify them? If unified, set
   `MEMORY_FILENAME` in `dual-context-loader.ts` to `PROJECT_LOG.md`.
2. **SYSTEM.md keep/drop** (see `docs/system-prompt-inventory.md`): confirm
   dropping the static tool list (it fights dynamic plan/build gating and
   duplicates always-sent schemas); drop the Pi-docs navigation block?; no
   conciseness directive?; reconfirm edit-tool wording; then activate the draft.
3. **Drift-monitor spec source** — what is "the agreed spec" it checks against?
   The approved plan, a `SPEC.md` the operator writes, the current `PROJECT_LOG`
   task? The harness has no spec-capture convention yet.
4. **Execution-grounded verdict** — how should the monitor run the spec's own
   checks given the read-only-PLAN-in-worker block? (A verify mode? a sandboxed
   build worker? a test-runner allowlist?)
5. **Worker context** — should headless workers run *without* the global overlay
   (clean, ungated, non-recursing), and should there be a build-by-default mode for
   writing workers? Depends on whether Pi has/needs a "no extensions" spawn flag.
6. **Throughput** — set monitor model + cadence to the operator's decode budget
   (secondary inference?) — operator-cluster-specific.
7. **Autonomy "run to completion"** — is the prompt-level signal enough, or is a
   tool-permission / auto-confirm mechanism wanted for true unattended runs?
8. **Minor:** rename `models.json`/`settings.json` to `*.example.json` to make
   their template nature unmistakable, or keep live names with placeholders?

---

## Local validation the operator should run (none done here)

1. All seven extensions load with no startup errors; `/plan`, `/build`, `/todos`,
   `/skill:formalization-gate` exist.
2. `/build` triggers the pre-flight on turn 1; `/build vetted` and `/build auto`
   skip it and inject their rationale; status footer reflects the level.
3. A `NOTES.md` in cwd/root appears in context and remains editable; `AGENTS.md`
   stays blocked by protected-paths.
4. `/skill:formalization-gate` loads the procedure; the model also surfaces it by
   description when formalization talk appears.
5. `delegate` spawns a worker and returns its result (confirm the `pi` subprocess
   resolves on the host; check `piInvocation`).
6. (If enabling) the drift monitor: create a `SPEC.md`, set `ENABLED=true`, confirm
   a verdict is produced and surfaced advisorily.
7. Re-confirm the two source-derived assumptions at runtime: `before_agent_start`
   chaining across extensions, and the `SYSTEM.md` assembly order.
