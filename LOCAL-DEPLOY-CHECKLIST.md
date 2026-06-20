# Local Deploy & Validation Checklist

For the operator, run **locally**. Building the artifacts was the web stage's job;
**installing, running, and validating is yours.** Work top to bottom; each step
has a "done when" so you know it passed.

> Reminder on the host: Fedora Silverblue is immutable. Install nothing on bare
> metal — Pi and Node live inside a **toolbox/Distrobox container**.

---

## 1. Install Pi and Node in a container

- [ ] Create and enter a container on the Silverblue host:
  ```sh
  toolbox create pi      # or: distrobox create -n pi ; distrobox enter pi
  toolbox enter pi
  ```
- [ ] Inside the container, install a current LTS **Node** (v20+). Use the
      container distro's package manager or `nvm`.
- [ ] Install **Pi** following its own README
      (`@earendil-works/pi-coding-agent`), typically a global npm install that
      provides the `pi` binary. Confirm the exact package/version against the Pi
      repo — do not assume.

**Done when:** `node --version` (v20+) and `pi --version` both print inside the
container.

---

## 2. Deploy this config repo to `~/.pi/agent/`

- [ ] Clone this repo into the container (or onto a path the container can see).
- [ ] From the repo root, link or copy `agent/` into `~/.pi/agent/` (see the
      README "How to deploy" section; symlink recommended). The five items are
      `AGENTS.md`, `APPEND_SYSTEM.md`, `models.json`, `settings.json`, and the
      `extensions/` directory.

**Done when:** `ls -l ~/.pi/agent` shows those five items (as symlinks or copies).

---

## 3. Fill in the placeholders

- [ ] Edit `~/.pi/agent/models.json`: set `baseUrl` to your Qwen endpoint, set
      `apiKey`, and set `models[0].id` to the served model id.
- [ ] Edit `~/.pi/agent/settings.json`: set `defaultModel` to the **same** id.
- [ ] Search for any leftover `REPLACE_ME` to be sure none remain:
  ```sh
  grep -r REPLACE_ME ~/.pi/agent
  ```

**Done when:** the `grep` returns nothing, and the model id matches in both files.

---

## 4. Confirm extensions load and `AGENTS.md` stacks

- [ ] Start Pi in a scratch directory: `mkdir -p ~/scratch && cd ~/scratch && pi`.
- [ ] Confirm the extensions loaded: the `/plan`, `/build`, and `/todos` commands
      exist (type `/` to list), and the footer shows a posture status.
- [ ] Test context stacking: create a project with its own `AGENTS.md` holding a
      distinctive line, then start Pi there:
  ```sh
  mkdir -p ~/projects/test && cd ~/projects/test
  printf '# Project AGENTS\n\nProject marker: BLUE-HERON-42\n' > AGENTS.md
  cp /path/to/this/repo/templates/PROJECT_LOG.md ./PROJECT_LOG.md
  pi
  ```
      Ask the agent to state its standing instructions and the project marker.

**Done when:** the agent reflects **both** the global posture/discipline **and**
the project marker `BLUE-HERON-42` — confirming global + project stacking.

---

## 5. Confirm PLAN blocks mutation and `/build` enables it

This is the centerpiece check — do not skip it.

- [ ] In a session that just started (so it's in **PLAN**), ask the agent to
      create a file, e.g. *"create a file note.txt containing hello"*.
      **Expect it to be blocked** with a plan-mode reason; `note.txt` is not
      created.
- [ ] Ask the agent to run a mutating shell command, e.g. *"run `touch x`"*.
      **Expect it to be blocked** (not on the read-only allowlist).
- [ ] Ask for a read-only command, e.g. *"run `ls -la`"*. **Expect it to run.**
- [ ] Type `/build`. The footer should switch to BUILD.
- [ ] Repeat the create-file request. **Expect it to succeed** now.
- [ ] Type `/plan`. Confirm it returns to read-only and a new write is blocked
      again.

**Done when:** writes/edits and mutating bash are refused in PLAN, allowed after
`/build`, and refused again after `/plan`.

> Also confirm protection: in BUILD mode, ask the agent to edit `AGENTS.md`.
> Expect `protected-paths` to block it even though you're in BUILD.

---

## 6. Run the first validation task

- [ ] Pick the first tenant project (the ARC dataset task — pure local data work,
      fully inspectable). Give it a real task and work the normal loop: plan in
      PLAN, `/build` one reviewable unit, review the diff, repeat.
- [ ] At the end, confirm the agent wrote a `PROJECT_LOG.md` entry.

**Watch for (process quality, not output):** interventions needed,
premature-implementation attempts the gate caught, errors you caught in diff
review, commit hygiene, and how legible the log is. These are the metrics you'll
re-use when you later swap Qwen → DS4 and re-validate.

---

## If something doesn't work

- Extensions didn't load → check they're in `~/.pi/agent/extensions/` and that Pi
  has no load errors on startup. The `.ts` files import Pi's own packages
  (`@earendil-works/pi-*`, `typebox`); if `todo.ts` or `dirty-repo-guard.ts`
  errors, your Pi version's API may differ — re-copy that file from your Pi
  version's own `examples/extensions/` (noted in each file's header).
- Plan mode didn't block → confirm `plan-mode-inverted.ts` loaded and the footer
  shows PLAN; check Pi's startup output for extension errors.
- Model won't connect → re-check `baseUrl`/`apiKey`/model `id` and that the
  endpoint is reachable from inside the container.
