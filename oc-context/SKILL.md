---
name: oc-context
version: 0.1.0
description: Surface prior opencode sessions as context. Use when the user references a past conversation ("remember the X issue", "we discussed Y last week", "continue what we were doing in Z") or when starting work in a familiar repo and prior context would help. Reads `~/.local/share/opencode/storage/` directly via the `oc-context` script — no markdown notes to maintain.
---

# oc-context — Reuse Prior opencode Sessions as Memory

## When to Use This Skill

Load this skill whenever:

- The user references a past conversation by topic, not by session ID
  ("remember our brave browser desync issue", "we fixed that lambda thing last week").
- You're starting work in a repository and want a quick digest of what you and the
  user have done there before, without asking them to repaste context.
- The user says something like "what have we done in this repo", "find that
  session about X", "open the one where we set up Y".
- You're about to ask the user to re-explain something they almost certainly
  explained in a prior session.

Do **not** load this skill for fresh tasks with no historical context, or when
the user has already given you enough to start.

## What It Does

`oc-context` is a Python CLI (stdlib only) that reads opencode's on-disk session
storage at `~/.local/share/opencode/storage/` and surfaces:

- Per-project session lists with titles, dates, files touched, and diff stats.
- Regex search across session titles, message summaries, and (optionally) full
  part text — opencode auto-summarizes each user message and patch, which is
  usually enough.
- A per-session "show" view with chronological message summaries.

It is read-only, has no dependencies, and is regenerable from disk. You should
treat it as a recall tool, not a source of truth — open the relevant
session(s) in opencode if the user wants to continue them.

## Invocation

The script lives at `~/.agents/skills/oc-context/scripts/oc-context` after
install. If `~/.agents/skills/oc-context/scripts/` is not on `PATH`, call it
by absolute path. A common setup is to add a single line to your shell rc:

```sh
export PATH="$HOME/.agents/skills/oc-context/scripts:$PATH"
```

(Or symlink the script into `~/.local/bin/`.) The examples below assume
`oc-context` is on PATH; otherwise substitute the absolute path.

## Quick Reference

```bash
oc-context stats                                  # storage summary
oc-context recent                                 # last 20 sessions, all repos
oc-context recent --cwd                           # last 20 in current worktree
oc-context recent --cwd --days 30 -n 5            # last 5 in last 30 days, here
oc-context search "brave desync"                  # title + summary search
oc-context search "key.?error" --full             # also scan full message text
oc-context search "deploy" --cwd                  # scoped to current repo
oc-context show ses_38723ba86ffeeg5oZuWxdQpqD7    # one session
oc-context show <id> --parts                      # include part text snippets
oc-context recent --json                          # machine-readable
```

All subcommands accept `--json` for downstream tooling.

## How to Use This as an Agent

### Pattern 1: explicit recall

User says: *"Remember our brave browser desync issue? It came up again."*

1. Run `oc-context search "brave"` (or `"sync"`, or both as alternation
   `"brave|sync"`).
2. If no title-level hit, retry with `--full` to scan part text.
3. Show the top 1-3 hits to the user with session IDs so they can pick.
4. If exactly one obvious match, fetch `oc-context show <id>` to summarize what
   was decided, then proceed.

### Pattern 2: starting in a repo

User opens a new chat in a repo you have history in.

1. Optionally run `oc-context recent --cwd -n 5` once at the start to see the
   most recent 5 sessions in this worktree.
2. Only mention them to the user if they're clearly relevant to the new task.
   Otherwise, just keep them in mind for the conversation.

### Pattern 3: cross-repo search

User says: *"Where did we set up that GitHub Actions OIDC thing?"*

1. Run `oc-context search "OIDC" --full` (global).
2. Identify the project from the worktree in the hit.

## Heuristics

- Prefer the cheap path first: title + message-summary search. Only add
  `--full` when no hits, since part text is large.
- Regex is case-insensitive. For multi-word queries, use space (literal) or
  alternation (`foo|bar`). Don't quote-escape unless the query has regex
  metacharacters.
- Session worktrees can drift if the user renamed a repo on disk; the script
  groups stats by *project ID* (stable) but search filters by worktree path
  (current). If a `--cwd` filter returns nothing surprising, drop `--cwd`.
- Older sessions can have `summary: false` instead of an object. The script
  handles this; if you see a parse error, it's a bug — file it.
- `~/.local/share/opencode/opencode*.db` files are **not** session data. They
  are LSP/symbol caches. Don't touch them.

## Data Layout (Reference)

```
~/.local/share/opencode/storage/
├── project/<projectID>.json          # worktree -> projectID mapping
├── session/<projectID>/ses_*.json    # session: title, slug, time, summary
├── message/ses_*/msg_*.json          # role, modelID, summary.title, summary.diffs
└── part/msg_*/prt_*.json             # type ∈ {text, reasoning, tool, patch, step-*, file}
```

The script reuses one `walk_sessions()` iterator and one `session_text_blob()`
loader. A future `semantic` subcommand can plug a vector index on top of the
same loader without changing the rest of the script.

## Out of Scope

- Editing or deleting sessions. Use opencode's own UI.
- Resuming a session programmatically. Open it in opencode by ID.
- Cross-tool history (e.g. Claude Code transcripts in `~/.claude/projects/`).
  Easy to add as a second reader; not in v0.1.

## Privacy

Everything stays local. The script never sends data over the network. Session
content can include source code, secrets you pasted, and full diffs — treat
search output like the rest of your shell history.
