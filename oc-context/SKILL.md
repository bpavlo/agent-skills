---
name: oc-context
version: 0.2.0
description: Recall prior opencode sessions. ALWAYS load when the user says "remember", "last time", "previously", "we discussed", "we fixed", "we set up", "continue", "where did we", "what have we done", or otherwise references a past conversation by topic instead of by session ID. Reads opencode's SQLite store directly via the `oc-context` CLI (recent / search / show / stats) and uses FTS5 for full-text search across all past message text — no manual markdown notes to maintain.
---

# oc-context — Reuse Prior opencode Sessions as Memory

## When to Load This Skill

Load it eagerly on any of these signals:

- Literal trigger words: **"remember"**, **"last time"**, **"previously"**,
  **"we discussed"**, **"we fixed"**, **"we set up"**, **"continue"**,
  **"where did we"**, **"what have we done"**, **"that issue we had"**,
  **"the one where"**.
- A user references a past conversation by *topic* without giving a session ID.
- Starting work in a familiar repository and prior session context would help
  you answer or act correctly.
- About to ask the user to re-explain something they almost certainly
  explained in a prior session.

Do **not** load it for fresh tasks where no prior history is implied.

## What It Does

`oc-context` is a Python CLI (stdlib only) that reads opencode's SQLite store
at `~/.local/share/opencode/opencode-stable.db` (auto-detects the newest
`opencode*.db`) and exposes:

- `recent` — most recent sessions, globally or filtered to `$PWD`.
- `search` — FTS5 full-text search across all message text and reasoning.
  Auto-builds and incrementally refreshes a sidecar index at
  `~/.local/share/oc-context/index.db`.
- `show` — one session's metadata, message summaries, and optionally part text.
- `stats` — counts and per-directory breakdown.
- `reindex` — manual reindex / `--full` rebuild.

It is **read-only** against opencode's DB (WAL mode allows concurrent readers)
and the sidecar index is regenerable from disk. Treat it as recall, not a
source of truth — to *resume* a session, open opencode and pick the session
by ID.

## Quick Reference

```bash
oc-context stats                            # what's there
oc-context recent                           # last 20 sessions, globally
oc-context recent --cwd                     # last 20 in current directory
oc-context recent --cwd --days 14 -n 5      # 5 recent, last 2 weeks, here
oc-context search "<phrase>"                # FTS5 search
oc-context search "<word1> <word2>" -n 5    # multi-word phrase OR token match
oc-context search "<term>" --cwd            # scoped to current directory
oc-context search "<a> NEAR/3 <b>"          # FTS5 operators
oc-context show <session_id>                # one session
oc-context show <session_id> --parts        # include part text
oc-context reindex                          # incremental refresh
oc-context reindex --full                   # rebuild from scratch
```

All subcommands accept `--json` (machine-readable) and `--db <path>` (override
the auto-detected source DB).

## Recommended Agent Usage Patterns

### Pattern 1 — explicit recall (most common)

User says: *"Remember our X issue?"* where X is some topic.

1. Run `oc-context search "X" --limit 5 --snippets 2`.
2. If one obvious hit, run `oc-context show <id>` to summarize what was
   decided.
3. Report the session ID and a one-paragraph summary to the user before
   continuing the task.

### Pattern 2 — recap on entering a repo

Fresh chat in a familiar worktree.

1. Optionally run `oc-context recent --cwd -n 5` at the start.
2. Keep titles in mind. Mention only if clearly relevant to the new task.

### Pattern 3 — cross-repo discovery

User asks where a topic was discussed without naming a repo.

1. Run `oc-context search "<topic>" --limit 10`.
2. Identify which directory from the per-hit metadata.

## Search Tips

- FTS5 syntax is supported: `"exact phrase"`, `term1 OR term2`,
  `term1 NEAR/3 term2`, prefix matches with `term*`.
- For plain unquoted multi-word queries, the tool builds both a phrase match
  and a token OR-match automatically, so `vesper flexoki` finds either word.
- If FTS5 returns nothing, try shorter queries or different word forms — the
  tokenizer is `unicode61 remove_diacritics`, no stemming.
- The search auto-reindexes when the source DB is newer than the index.
  Use `--no-refresh` for repeated queries on the same snapshot.

## Heuristics

- Default to global search. Use `--cwd` only when you're confident the topic
  was scoped to the current directory.
- For "recently" / "last time" without a specific topic, prefer
  `oc-context recent --days 14`.
- Cite the session ID (`ses_…`) when surfacing results so the user can open
  it in opencode if they want the full thread.
- Tokens: snippet output frames matches with `<<…>>`. Treat the highlighted
  span as the strongest evidence for relevance.

## Data Layout (Reference)

opencode now stores sessions in SQLite, not JSON-on-disk:

```
~/.local/share/opencode/
├── opencode-stable.db       # active store
├── opencode.db              # older, possibly stale
└── storage/                 # legacy JSON layout, mostly frozen
```

Key tables in the DB:
- `project(id, worktree, …)` — repo / worktree mapping.
- `session(id, project_id, directory, title, time_updated, summary_*, …)`.
- `message(id, session_id, data)` — `data` is JSON with `role`, `modelID`, etc.
- `part(id, message_id, session_id, data)` — `data` is JSON with `type` ∈
  `{text, reasoning, tool, patch, step-*, file, compaction}`. Text and
  reasoning parts hold the searchable prose.

The sidecar FTS index at `~/.local/share/oc-context/index.db` mirrors only
`text` and `reasoning` parts. Tool output and step markers are skipped.

See `references/storage-layout.md` for the full schema dump.

## Out of Scope

- Editing or resuming sessions — use opencode itself.
- Cross-tool history (Claude Code `~/.claude/projects/*.jsonl`). Easy to add
  as a second source; not in v0.2.
- Embeddings / semantic search. FTS5 covers 90% of "remember the X thing"
  recall at zero setup cost.

## Privacy

Everything stays local. The script makes no network calls. Session content
includes source code and anything you pasted in past sessions — treat the
sidecar index with the same care as your shell history.
