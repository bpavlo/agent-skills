# opencode storage layout (SQLite era)

Reference for what lives under `~/.local/share/opencode/`. opencode migrated
from JSON-on-disk to SQLite; this document covers the SQLite layout and
notes the legacy directories that still exist.

## Filesystem

```
~/.local/share/opencode/
├── auth.json                      # provider auth (do not read)
├── mcp-auth.json
├── opencode-stable.db             # ACTIVE store — sessions, messages, parts
├── opencode-stable.db-wal         # WAL log (live writer)
├── opencode-stable.db-shm
├── opencode.db                    # older store; may be stale after migration
├── log/
├── snapshot/                      # git-style snapshots per project (active)
├── tool-output/                   # large tool outputs (active)
└── storage/                       # legacy JSON, mostly frozen post-migration
    ├── project/<projectID>.json
    ├── session/<projectID>/ses_*.json
    ├── message/ses_*/msg_*.json
    ├── part/msg_*/prt_*.json
    └── session_diff/...           # still written for some sessions
```

The legacy `storage/` tree no longer reflects current activity. Read the DB.

## Auto-detection

Multiple `opencode*.db` files can co-exist (e.g. `opencode.db` from an older
channel and `opencode-stable.db` from the current channel). `oc-context`
picks the one with the most recent mtime; override with `--db`.

## Read-only access

opencode keeps a long-lived writer on the DB in WAL mode. Readers must use
`file:<path>?mode=ro` URI — **do not** add `nolock=1`, it deadlocks against
WAL. Multiple concurrent readers are fine.

```python
import sqlite3
conn = sqlite3.connect("file:/.../opencode-stable.db?mode=ro", uri=True)
```

## Schema (key tables)

### `project`

```sql
CREATE TABLE project (
    id TEXT PRIMARY KEY,
    worktree TEXT NOT NULL,
    vcs TEXT,
    name TEXT,
    icon_url TEXT,
    icon_color TEXT,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    time_initialized INTEGER,
    sandboxes TEXT NOT NULL,
    commands TEXT,
    icon_url_override TEXT
);
```

`id` is a 40-char hex hash, stable across renames. There is a synthetic
`global` project with `worktree = '/'` for sessions outside any repo.

### `session`

```sql
CREATE TABLE session (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    parent_id TEXT,
    slug TEXT NOT NULL,
    directory TEXT NOT NULL,   -- the actual worktree at session creation
    title TEXT NOT NULL,
    version TEXT NOT NULL,
    share_url TEXT,
    summary_additions INTEGER,
    summary_deletions INTEGER,
    summary_files INTEGER,
    summary_diffs TEXT,
    revert TEXT,
    permission TEXT,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    time_compacting INTEGER,
    time_archived INTEGER,
    workspace_id TEXT,
    path TEXT,
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);
CREATE INDEX session_project_idx ON session(project_id);
CREATE INDEX session_parent_idx  ON session(parent_id);
```

Indexed by project and parent. Time fields are Unix milliseconds.
`time_archived IS NOT NULL` marks a session as hidden from the default UI;
exclude it unless `--archived` is requested.

### `message`

```sql
CREATE TABLE message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    data TEXT NOT NULL,        -- JSON
    FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
);
CREATE INDEX message_session_time_created_id_idx
    ON message(session_id, time_created, id);
```

`data` JSON shape:

```json
{
  "role": "user" | "assistant",
  "modelID": "<provider model id>",
  "providerID": "<provider>",
  "mode": "build",
  "agent": "build",
  "summary": {
    "title": "<short summary of the message>",
    "diffs": [{ "file": "<path>", "before": "<snippet>" }]
  },
  "tokens": { "total": 0, "input": 0, "output": 0 }
}
```

Use `json_extract(data, '$.role')` for the common query.

### `part`

```sql
CREATE TABLE part (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL,
    data TEXT NOT NULL,        -- JSON
    FOREIGN KEY (message_id) REFERENCES message(id) ON DELETE CASCADE
);
CREATE INDEX part_session_idx ON part(session_id);
CREATE INDEX part_message_id_id_idx ON part(message_id, id);
```

`data.type` values seen in practice:

| type         | notes                                              |
|--------------|----------------------------------------------------|
| `tool`       | tool call + state.output (large, noisy)            |
| `step-start` | turn marker                                        |
| `step-finish`| turn marker                                        |
| `reasoning`  | model reasoning trace (searchable)                 |
| `text`       | user/assistant prose (searchable, primary signal)  |
| `patch`      | `data.files` lists patched files                   |
| `file`       | attached file reference                            |
| `compaction` | session summarization marker                       |

For recall, `text` and `reasoning` are the useful kinds. `oc-context`
indexes only those into FTS5.

## FTS5 sidecar

`oc-context` keeps its own DB at `~/.local/share/oc-context/index.db`:

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE VIRTUAL TABLE part_fts USING fts5(
    text,
    session_id UNINDEXED,
    message_id UNINDEXED,
    part_id    UNINDEXED,
    role       UNINDEXED,
    kind       UNINDEXED,
    tokenize='unicode61 remove_diacritics 2'
);
```

`meta` keys:
- `source_db` — absolute path of the opencode DB we indexed.
- `last_part_id` — highest `part.id` seen; incremental refresh uses
  `WHERE part.id > last_part_id`.
- `last_refresh_ms` — source DB mtime at last refresh; used to skip work.

If `source_db` changes (channel switch), the sidecar is dropped and rebuilt.
