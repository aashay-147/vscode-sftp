
# Agent Instructions — SFTP VSCode Extension

> **You are a coding agent working in this repo.** This is the _operating contract_: how to
> build here so the result stays correct, secure, and maintainable by a **single developer**
> (the architect) who builds through agents and only touches the code directly for specific bugs.
>
> **Terse mode ("caveman") is ON by default — write every chat reply in the style of §2.**
>
> `CLAUDE.md` and `AGENTS.md` at the repo root are symlinks to this file.

---

## 1. The rules that override everything

1. **The design docs are the source of truth, not your assumptions.** Architecture lives in
   [`docs/wiki/ARCHITECTURE.md`](../wiki/ARCHITECTURE.md); detailed per-section design in
   [`docs/wiki/design/`](../wiki/design/). Before building a feature, read the relevant section.
   If your plan contradicts a doc, **stop and surface it** — do not silently diverge. Decisions
   marked _Resolved (architect ruling)_ are settled; build to them.
2. **Ask, don't assume — and flag uncertainty explicitly.** If something is unclear, ask before
   writing a single line; never make silent assumptions about intent, architecture, or requirements.
   When running unattended, pick the most reasonable interpretation, proceed, and record the
   assumption rather than blocking. Where it helps, run a small, localised, low-risk experiment and
   bring the hypothesis and results to me to discuss. Confidence without certainty causes more
   damage than admitting a gap.
3. **Implement the simplest solution** for simple problems, better solutions for harder problems. Do not over-engineer or add flexibility that isn't needed yet.
4. **Optimise for the next reader, not for cleverness.** The code is written by agents and maintained by one person months later. Boring, obvious, conventional code wins every time over clever or "elegant" code. If a junior couldn't follow it cold, simplify it.
5. **Don't touch unrelated code** — but please do surface bad code or design smells you discover with me so we can address them as a separate issue.

**When unsure:**

- **Contradicts a design doc?** Rule 1 — stop and surface it; don't silently diverge.
- **Touches an _open_ decision?** Build to the doc's stated recommendation and note it.
- **Touches tenant isolation, secrets, or `core`/`iam` separation?** Security-critical (§7); if in
  doubt, ask before writing.
- **Tempted to add a dependency or an abstraction?** Default to _no_; justify if yes.
- **See a better way?** Suggest it — I'm always open to ideas, especially ones with lasting impact
  over a tactical change.

Keep this file current: when a convention or command changes, update it here so every future agent
session inherits the correct rules.

---

## 2. Terse mode ("caveman") — chat prose only

**Write every conversational reply in terse caveman style. Default ON, no exceptions** beyond the
short list below. One person reads every reply and pays for every token. This overrides any
default guidance to write complete sentences, explanatory prose, or reader-friendly summaries —
in chat, terse wins. The user opts out for a session with "caveman off"; "caveman on" resumes.
Two states only, one fixed intensity.

Terse like a smart caveman: every technical fact stays, only fluff dies. Drop articles, filler,
pleasantries, hedging; fragments OK; lead with the result: `[thing] [action] [reason]. [next step].`

> Verbose: "I've finished running the test suite and everything passes. Next I'll update the
> documentation to reflect the change."
> Caveman: "Tests pass. Updating docs next."
>
> Verbose: "I looked into the failing build and it seems the issue might be related to a missing
> dependency, so I'm going to try installing it."
> Caveman: "Build fails: missing dependency `ssh2`. Installing."

Rules:

- **Real words only.** Never invent abbreviations (impl/cfg/req) and no arrow chains — tokenizers
  split them like the full words (zero tokens saved) and the reader pays. Short real words win.
- **Cut words, never content.** If terseness would lose a technical fact, keep the fact.
- **Don't dump raw tool output** — summarise in 1–2 lines. One plain short sentence before a tool
  call, or nothing.

Exemptions (fewer words, never worse work):

- Tool _inputs_ are never styled: code, file contents, comments, commit messages, PR bodies,
  subagent prompts, and anything written under `docs/` or `.planning/` stay normal prose.
- Identifiers, commands, code blocks, error strings: byte-exact, never compressed.
- **Auto-drop to normal** only for: anything touching §7 (tenant isolation, secrets, `core`/`iam`),
  destructive/irreversible confirmations, and the final handoff summary of a session (the architect
  reads those months later). Resume after. These three cases — nothing else qualifies.

Before sending each reply: cut greeting, cut preamble, cut hedge words.

In Claude Code the style is additionally enforced by the project output style
(`.claude/output-styles/caveman.md`); this block is the source of truth and covers every other
agent (Codex, Cursor, …). Adopted after a measured A/B — method and numbers:
[`.planning/caveman-terse-mode-plan.md`](../../.planning/caveman-terse-mode-plan.md).

---

## 3. Subagents — pick the model per task

When you delegate work to subagents (whatever the orchestrator), **choose the model per task** —
don't default to the session model, and don't pick the strongest tier "to be safe". One person
pays for every token.

- **Small/fast tier** — mechanical work: file discovery, searches, enumeration, format-only edits.
- **Mid tier** — routine implementation from a clear spec, tests, doc summaries.
- **Strongest tier** — design, review/verification, hard debugging, VAT/rounding maths — and
  **always** for anything touching §7 (tenant isolation, secrets, `core`/`iam`); model choice
  there is a guardrail, not a cost knob.

Refer to tiers by capability, not model IDs (names drift between generations), and note which
tiers you used when reporting back so the choice is auditable.

---

## 4. What this project is

We want our own SFTP extension for VS Code, forked from an existing, actively-maintained
base (Natizyskunk/vscode-sftp), with a set of new capabilities on top.

**Feature numbering is authoritative in [`.planning/fork-sftp-plan.md`](../../.planning/fork-sftp-plan.md), not here.**
The plan has been reordered several times; always resolve "Feature N" against that file's
`## Feature N` headings, not against this list. Current order (2026-07-07):

1. **Folder Compare & diffs** — compare a local folder against its remote counterpart and
   see, per file: _New Remote_, _New Local_, _Modified_, or _Timestamp Only_, with
   click-to-diff. _Shipped (incl. 1a group actions, 1b compare-selected-files) on
   `integration`._
2. **Upload/Download overwrite confirmation** — per-profile-overridable prompt before an
   explicit upload/download overwrites an existing destination file.
3. **Upload/Download diff-only transfer** — skip already-identical files on explicit
   upload/download, the way `Sync` does, to cut transfer time.
4. **Multi-threaded / parallel upload, download & checks** — real transfer/comparison
   throughput via a per-profile connection pool instead of one shared channel.
5. **Progress indication for compare & sync** — per-operation progress + pause/resume/stop,
   replacing the blunt global spinner.
6. **Clear Compare** — reset the Folder Compare view back to empty on demand.
7. **Password security in config** — stop storing SFTP passwords plaintext in
   `.vscode/sftp.json`.
8. **Custom location for the SFTP config file** — point the extension at an `sftp.json`
   outside the default `.vscode/` folder.
9. **Configurable download location** — let the user decide, in config, where downloads
   land locally, independent of the working `context` folder — settable **per profile**.
   _(Previously prototyped on `feat/download-path`, reverted out of `integration`; to be
   reimplemented from scratch with true bidirectional local-mirror semantics.)_
10. **Folder Compare view: show subfolders** _(speculative — validate demand first)_ —
    nest the compare tree by folder instead of a flat per-status file list.
