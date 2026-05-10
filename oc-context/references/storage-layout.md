# opencode storage layout

Reference for what lives under `~/.local/share/opencode/storage/`. Captured
from a real install on 2026-05-10 against opencode 1.1.65.

```
~/.local/share/opencode/
├── auth.json                          # provider auth (do not read)
├── mcp-auth.json                      # MCP server auth (do not read)
├── opencode.db / opencode-stable.db   # LSP/symbol cache — NOT sessions
├── log/                               # opencode runtime logs
├── snapshot/                          # workspace snapshots
├── tool-output/                       # large tool outputs spilled out of parts
└── storage/
    ├── project/<projectID>.json
    ├── session/<projectID>/ses_*.json
    ├── message/ses_*/msg_*.json
    ├── part/msg_*/prt_*.json
    ├── session_diff/...               # per-session aggregated diffs
    ├── todo/...                       # per-session todo lists
    └── migration                      # opencode internal
```

## project/<projectID>.json

```json
{
  "id": "8c640995d6a99402bb7635ad1f4d45b394fef0bb",
  "worktree": "/home/pavlo/work/barley",
  "vcs": "git",
  "sandboxes": [],
  "time": { "created": 1770941036386, "updated": 1771554221911 }
}
```

`projectID` is a SHA-1-like hash; it is *not* derived from the worktree path
(renaming a repo on disk keeps the same project ID). `worktree` is the *latest*
path opencode saw for that project.

## session/<projectID>/ses_*.json

```json
{
  "id": "ses_38723ba86ffeeg5oZuWxdQpqD7",
  "slug": "clever-star",
  "version": "1.1.65",
  "projectID": "8c640995d6a99402bb7635ad1f4d45b394fef0bb",
  "directory": "/home/pavlo/work/barley",
  "title": "Lambda registry KeyError fix in detect_affected_lambdas.py",
  "time": { "created": 1771554227577, "updated": 1771554244237 },
  "summary": { "additions": 2, "deletions": 0, "files": 1 }
}
```

`directory` is the session's worktree at the time it was created — it may
differ from `project.worktree` if the repo was moved between sessions.

`summary` may be `false` for some old sessions; callers must defensively
type-check before treating it as an object.

## message/ses_*/msg_*.json

User message:

```json
{
  "id": "msg_c78dc457b001IuhkihCau4u6qk",
  "sessionID": "ses_...",
  "role": "user",
  "time": { "created": 1771554227585 },
  "summary": {
    "title": "Fix KeyError in detect_affected_lambdas.py",
    "diffs": [
      { "file": "...py", "before": "..." }
    ]
  }
}
```

Assistant message:

```json
{
  "id": "msg_...",
  "sessionID": "ses_...",
  "role": "assistant",
  "time": { "created": ..., "completed": ... },
  "parentID": "msg_...",
  "modelID": "claude-sonnet-4-6",
  "providerID": "anthropic",
  "mode": "build",
  "agent": "build",
  "path": { "cwd": "...", "root": "..." },
  "cost": 0,
  "tokens": { "total": ..., "input": ..., "output": ..., "cache": {...} },
  "finish": "tool-calls"
}
```

Assistant messages usually lack `summary`; the content lives in their `part/`
children.

## part/msg_*/prt_*.json

Types observed in the wild (sampled count from a real corpus of ~4700 parts):

| type         | shape                                                    |
|--------------|----------------------------------------------------------|
| `text`       | `{ text: "..." }` — the actual user/assistant prose      |
| `reasoning`  | `{ text: "..." }` — model reasoning trace                |
| `tool`       | `{ tool, callID, state: { input, output, status } }`     |
| `patch`      | `{ hash, files: [...] }` — refers to session_diff entry  |
| `file`       | `{ filename, url, source: { path, ... } }` — attachment  |
| `step-start` | tool/turn boundary marker                                |
| `step-finish`| tool/turn boundary marker                                |
| `subtask`    | nested agent invocation                                  |

For digest / search, the useful types are `text`, `reasoning`, and `patch`.
`tool` outputs are large and noisy — include only when you need to scan
specific tool calls.
