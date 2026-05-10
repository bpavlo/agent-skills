# agent-skills

Personal skills for AI coding agents (Claude Code, opencode, Cursor, etc.).
Each top-level directory is one skill: a `SKILL.md` with YAML frontmatter,
optionally with a `references/` directory.

## Skills

| Skill | Description |
|---|---|
| [`lua-vibe`](./lua-vibe) | Lua best practices and ecosystem (LuaRocks, busted, lua-language-server, stylua, luacheck/selene, LuaCATS). |
| [`nix-vibe`](./nix-vibe) | Nix flakes and NixOS / nix-darwin / home-manager patterns. |
| [`oc-context`](./oc-context) | Reuse prior opencode sessions as context. Ships a Python CLI (`oc-context`) that reads `~/.local/share/opencode/storage/` so agents can recall past conversations without manual notes. |

## Install

Symlinks each skill into `~/.agents/skills/<name>` (and `~/.claude/skills/<name>`
when that directory exists). Requires Node ≥ 18 and `git`.

```sh
npx github:bpavlo/agent-skills install              # all
npx github:bpavlo/agent-skills install lua-vibe     # one
npx github:bpavlo/agent-skills update               # pull latest
npx github:bpavlo/agent-skills list
npx github:bpavlo/agent-skills uninstall [<name>]
npx github:bpavlo/agent-skills path                 # show install dir
```

## License

MIT. See [LICENSE](./LICENSE).
