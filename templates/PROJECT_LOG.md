# PROJECT_LOG

This is the agent's working memory for **this project**. It is plain text and git
that the operator can read — there is no other hidden memory.

**Convention:**
- The agent **appends one short entry per session.** Writing the entry is the
  **completion condition** of the session's task — the task is not done until the
  log is updated.
- The agent **reads this file at the start of a session** to recover context.
- Newest entry at the top. Keep entries concise and in plain language. Record
  decisions and open questions, not a transcript.

Deployment note: copy this file into a new project directory (alongside the
project's own `AGENTS.md`). It is intentionally **not** write-protected — unlike
`AGENTS.md`, this file is meant for the agent to write.

---

<!-- Copy the block below for each new session entry (newest on top). -->

## YYYY-MM-DD — <short title>

**Done:** what was accomplished this session.

**Next:** the very next step(s) for the following session.

**Decisions / open questions:** anything chosen and why, or anything still
unresolved that needs the operator.

---

## (example) 2026-01-01 — Project kickoff

**Done:** Read the project `AGENTS.md`; in PLAN mode, surveyed the data layout
and proposed a three-step plan (discovery → transform → stats). Operator approved
step 1.

**Next:** On `/build`, implement the discovery pass and commit it for review.

**Decisions / open questions:** Open — confirm the expected output format for the
stats step before starting it.
