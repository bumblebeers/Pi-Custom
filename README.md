# The Augment — Pi Harness Config Repo

This is the **config repo** for *The Augment*: a general-purpose, model-agnostic
personal AI workstation harness, built as **extensions + configuration layered on
stock Pi** ([`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi)).

It does **not** modify Pi itself. Everything here is config and extensions that
deploy into Pi's global agent directory (`~/.pi/agent/`). This keeps the harness
intact across Pi upgrades and an eventual OS migration.

> **New here?** Read this file for the layout and deploy model, then follow
> [`LOCAL-DEPLOY-CHECKLIST.md`](./LOCAL-DEPLOY-CHECKLIST.md) to install and
> validate. The running history of the build is in [`BUILD_LOG.md`](./BUILD_LOG.md).

---

## The one idea to understand first: the inverted posture

The harness **starts in PLAN mode** — read-only research and planning. It cannot
edit or write files, and it cannot run shell commands that change anything. To
make changes, the operator explicitly switches to **BUILD** mode with `/build`,
and returns to read-only with `/plan`.

Two reasons this is the spine of the design:

1. **It structurally prevents premature implementation.** A weaker local model
   *cannot* mutate in plan mode even if it tries — the block is enforced in code,
   not just requested in a prompt.
2. **It makes the work reviewable by reading diffs.** Because a plan is agreed
   before any building, each diff review becomes *"does this match what we
   agreed?"* instead of *"what is this code even doing?"*

One `/build` authorises a whole **reviewable unit of work** (e.g. "do the
discovery pass"), not a single action — so well-specified work doesn't turn into
approving every keystroke.

---

## Layout

```
.
├── README.md                  ← you are here (layout + deploy model)
├── BUILD_LOG.md               ← running build journal (decisions, what's next)
├── LOCAL-DEPLOY-CHECKLIST.md  ← operator's local install + validation steps
│
├── agent/                     ← THIS DIRECTORY DEPLOYS TO  ~/.pi/agent/
│   ├── AGENTS.md              ← global cross-project standing brief
│   ├── APPEND_SYSTEM.md       ← minimal non-negotiable posture rules (system layer)
│   ├── models.json            ← model/provider config (Qwen placeholder)
│   ├── settings.json          ← default provider/model + Pi settings
│   └── extensions/            ← auto-discovered by Pi on startup
│       ├── plan-mode-inverted.ts   ← the centerpiece (custom)
│       ├── protected-paths.ts      ← write-protect steering files (configured)
│       ├── dirty-repo-guard.ts     ← nudge small, frequent commits (upstream copy)
│       └── todo.ts                 ← in-session task decomposition (upstream copy)
│
└── templates/
    └── PROJECT_LOG.md         ← copy into each project as agent-writable memory
```

**The deploy rule is simple: everything inside `agent/` maps 1:1 to
`~/.pi/agent/`.** The repo-root files (`README.md`, `BUILD_LOG.md`,
`LOCAL-DEPLOY-CHECKLIST.md`) and `templates/` are documentation/source — they do
**not** deploy into the agent directory.

---

## How to deploy it to `~/.pi/agent/`

You have two options. **Symlinking is recommended** so that `git pull`ing this
repo updates your live harness with no extra copy step.

> Do **not** symlink the whole `~/.pi/agent/` directory to `agent/` — that
> directory also holds Pi's own runtime state (`auth.json`, `sessions/`, `bin/`)
> which must not live in git. Link the individual items instead.

### Option A — symlink (recommended)

```sh
# from the root of this repo
PI=~/.pi/agent
mkdir -p "$PI"
ln -sf "$PWD/agent/AGENTS.md"        "$PI/AGENTS.md"
ln -sf "$PWD/agent/APPEND_SYSTEM.md" "$PI/APPEND_SYSTEM.md"
ln -sf "$PWD/agent/models.json"      "$PI/models.json"
ln -sf "$PWD/agent/settings.json"    "$PI/settings.json"
ln -sf "$PWD/agent/extensions"       "$PI/extensions"
```

### Option B — copy

```sh
PI=~/.pi/agent
mkdir -p "$PI"
cp -r agent/. "$PI/"
```

After deploying, **fill in the placeholders** in `~/.pi/agent/models.json` and
`~/.pi/agent/settings.json` (the Qwen endpoint address, model id, and any
secret). See the checklist for exact steps.

---

## Model configuration

`agent/models.json` ships with a **single provider** (`qwen-local`, an
OpenAI-compatible endpoint such as vLLM) and **placeholder** values you replace
at deploy time:

- `baseUrl` — your Qwen endpoint, e.g. `http://HOST:PORT/v1`
- `apiKey` — a key if your endpoint needs one; any non-empty string if it doesn't
- `models[0].id` — the model id your endpoint serves

`agent/settings.json` sets `defaultProvider` (`qwen-local`) and `defaultModel`
(**must equal** the `id` in `models.json`). `compat.maxTokensField` is set to
`max_tokens` for OpenAI-compatible servers; vLLM applies the model's shipped
sampling defaults, so no extra sampling config is needed.

**Adding DeepSeek-V4 (DS4) later** — the design swaps the model only *after* the
harness is validated on Qwen, so the read on each change stays clean. When that
time comes, add a second provider (or a second entry in `models[]`) to
`models.json`, then switch live with the `/model` command. Qwen-specific compat
flags exist if needed later (e.g. `thinkingFormat: "qwen"`, plus a
`thinkingLevelMap` where `null` hides an unsupported level) — add them only if a
model actually requires them.

---

## The two-layer context model

Pi auto-loads `AGENTS.md` files from the current directory upward, **plus** the
global `~/.pi/agent/AGENTS.md`, and stacks them (global first, then project).

- **Global layer (`agent/AGENTS.md`)** — the cross-project standing brief: the
  working discipline and the plan/build posture. Write-protected, so the agent
  can't quietly rewrite its own instructions.
- **Per-project layer** — each project directory gets its own `AGENTS.md`
  (project specifics, which *you* author) and a `PROJECT_LOG.md` (the agent's
  session memory, which *the agent* writes). Copy `templates/PROJECT_LOG.md` into
  a new project to start.

This is the whole memory system on purpose: **memory is plain files + git you can
read**, not a hidden store. The human-authored steering (`AGENTS.md`) is
protected; the agent-writable memory (`PROJECT_LOG.md`) is not.

---

## What is *not* here (deferred by design)

Web tooling / `read_url`, sub-agents, a separate scratchpad distinct from
`PROJECT_LOG.md`, scheduling, and any richer memory system are **out of the
first stage** — added later on demand, never speculatively. If the harness ever
feels like it's sprawling, the fix is a tighter `AGENTS.md` and smaller commits,
not more tooling.

---

## Note on testing

Building these artifacts is the whole job of the web stage. **Running and
validating the harness is done locally by the operator** — see
[`LOCAL-DEPLOY-CHECKLIST.md`](./LOCAL-DEPLOY-CHECKLIST.md).
