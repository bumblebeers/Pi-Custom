# Pi Default System Prompt — Inventory & Replacement Plan (Build Ledger item 3)

This is the **required first step** for the `SYSTEM.md` full-replace: inventory
Pi's actual default system prompt, separate operational scaffolding (keep) from
behavioral defaults (drop), and reason about what a full replace must reintroduce.
The draft lives in `agent/SYSTEM.draft.md` (deliberately **not** the active
`SYSTEM.md` filename — see "Activation" below).

All facts below were verified against the actual Pi source (`earendil-works/pi`,
v0.79.9), not memory.

## How Pi assembles the system prompt (verified)

`packages/coding-agent/src/core/system-prompt.ts` → `buildSystemPrompt()`. There
are two branches:

- **Default branch** (no custom prompt): emits the base template, which
  interpolates `${toolsList}` (per-tool one-line snippets) and `${guidelines}`
  (file-handling bullets), then appends: appended-system-prompt → `<project_context>`
  (AGENTS.md/CLAUDE.md) → skills section (if `read` active) → `Current date` + `cwd`.
- **Custom branch** (a `SYSTEM.md` / `--system-prompt` is set): emits
  `customPrompt` verbatim, then appends the **same tail**: appended-system-prompt →
  `<project_context>` → skills → date + cwd. **It does NOT emit `${toolsList}` or
  `${guidelines}`.**

**The single most important consequence:** a full-replace `SYSTEM.md` silently
drops the tool snippets and every file-handling guideline. The tool *schemas*
(each tool's full `description` + parameters) are sent separately on every
request regardless, so the model still knows the tools exist and how to call
them — what's lost is the one-line usage hints and the file-handling discipline
("use read instead of cat", the edit-tool rules). Those are exactly the
operational scaffolding a weaker local model benefits from, so the replacement
must reintroduce them on our terms.

What still arrives automatically after `customPrompt` (so we must NOT duplicate it):
`APPEND_SYSTEM.md` (our posture rules), `AGENTS.md` (our standing brief, wrapped
in `<project_context>`), the skills list (so `/skill:formalization-gate` is still
advertised), and the date/cwd footer.

## Inventory of the default prompt, component by component

| # | Component (verbatim anchor) | Class | Decision |
|---|---|---|---|
| 1 | "You are an expert coding assistant operating inside pi…" | Behavioral (persona) | **Drop & replace** with The Augment identity (augmentation, not replacement). |
| 2 | `Available tools:` + per-tool snippets ("Read file contents", …) | Scaffolding | **Drop the static list.** Reasoning below — it fights dynamic plan/build gating and duplicates the always-sent schemas. |
| 3 | "In addition to the tools above, you may have access to other custom tools…" | Scaffolding (minor) | Drop (schemas cover it). |
| 4 | "Use read to examine files instead of cat or sed." | Scaffolding (file-handling) | **Keep** — reintroduce in our wording. |
| 5 | "Use write only for new files or complete rewrites." | Scaffolding | **Keep** — reintroduce. |
| 6 | Edit guidelines (oldText must match exactly; batch disjoint edits; no overlapping/nested; keep oldText minimal) | Scaffolding (edit mechanics) | **Keep** — reintroduce; genuinely load-bearing for correct edit-tool use. |
| 7 | Conditional "Use bash for file operations like ls, rg, find" (only when grep/find/ls tools absent) | Scaffolding | **Keep** — reintroduce as a conditional note. |
| 8 | "Be concise in your responses" | Behavioral (tone) | **Drop** — and note it is auto-dropped by the custom branch anyway. It competes with the review-by-diff posture (which wants substantive plain-language explanation). |
| 9 | "Show file paths clearly when working with files" | Mixed → scaffolding | **Keep**. |
| 10 | "Pi documentation (read only when the user asks about pi itself…)" + doc-path list | Scaffolding (Pi-navigation) | **Drop by default; FLAG.** Paths are interpolated dynamically by Pi and the harness is general-purpose, not primarily for Pi-internals work. Re-add (with concrete paths) if the operator works on Pi itself. |
| 11 | Skills section | Scaffolding | **Leave to Pi** — still appended in the custom branch. |
| 12 | `Current date` / `Current working directory` | Scaffolding (env) | **Leave to Pi** — still appended. |

## Reasoning on the contested calls

- **Why drop the static tool list (#2), the most consequential call.** Pi's
  default `${toolsList}` is *dynamic* — it reflects the currently active tools and
  rebuilds on `setActiveTools()`. Our plan/build extension narrows the active set
  in PLAN and restores it in BUILD. A *static* tool list hard-coded in `SYSTEM.md`
  would therefore be wrong half the time — e.g. listing `edit`/`write` while the
  agent is in read-only PLAN — which is exactly the false signal a weaker model
  might act on. The dynamic "which tools are available right now" job is already
  done by the plan-mode mode block (injected every turn), and the full tool
  schemas are always sent. So the static list is dropped on purpose. **This is the
  main thing to confirm in the design conversation.**

- **Why keep the file-handling/edit guidelines (#4–7, #9).** These are
  tool-*usage* discipline, not tool *availability*; they don't change with mode,
  and a weaker model needs them more, not less. They are reintroduced in our own
  wording in the draft, based on the v0.79.9 tool guidelines — **confirm they
  match the operator's Pi version's edit-tool semantics.**

- **Why the draft is identity + scaffolding only, not the whole philosophy.** The
  distilled collaboration teaching lives in `AGENTS.md` (the standing brief) and
  the non-negotiable posture rules in `APPEND_SYSTEM.md`; both are appended after
  `customPrompt` automatically. `SYSTEM.md` deliberately stays narrow — replace
  the generic persona, reintroduce operational scaffolding — to avoid duplicating
  them.

## Open keep/drop questions for the design conversation

1. **Static tool list** — confirm dropping it (rely on schemas + the dynamic mode
   block) is right, vs. wanting an explicit in-prompt tool list despite the
   gating tension.
2. **Pi-docs navigation block (#10)** — drop (default) or re-add for Pi-internals work?
3. **Conciseness** — confirm we want no conciseness directive at all (the posture
   favours substantive explanation).
4. **Edit-tool wording** — confirm the reintroduced edit rules match the operator's
   Pi version.

## Activation

The draft is `agent/SYSTEM.draft.md`. It is inert until renamed to `SYSTEM.md`
(Pi only discovers the exact name `~/.pi/agent/SYSTEM.md`, or project
`<cwd>/.pi/SYSTEM.md` when the project is trusted). After the questions above are
resolved, rename it to activate, and add it to the deploy list. Leaving it as
`.draft` means deploying the overlay cannot silently swap the base prompt before
review.
