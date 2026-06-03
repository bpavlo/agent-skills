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

### Vendored from upstream

Copied from upstream monorepos (OpenClaw's `git:` installer can't target a
monorepo subdirectory). Provenance and pinned commits: [SOURCES.md](./SOURCES.md).

| Skill | Upstream |
|---|---|
| [`mcp-builder`](./mcp-builder) | anthropics/skills |
| [`test-driven-development`](./test-driven-development) | obra/superpowers |
| [`receiving-code-review`](./receiving-code-review) | obra/superpowers |
| [`requesting-code-review`](./requesting-code-review) | obra/superpowers |
| [`karpathy-guidelines`](./karpathy-guidelines) | forrestchang/andrej-karpathy-skills |
| [`pulumi-best-practices`](./pulumi-best-practices) | pulumi/agent-skills |
| [`pulumi-component`](./pulumi-component) | pulumi/agent-skills |
| [`pulumi-esc`](./pulumi-esc) | pulumi/agent-skills |
| [`pulumi-automation-api`](./pulumi-automation-api) | pulumi/agent-skills |
| [`package-usage`](./package-usage) | pulumi/agent-skills |
| [`provider-upgrade`](./provider-upgrade) | pulumi/agent-skills |
| [`pulumi-arm-to-pulumi`](./pulumi-arm-to-pulumi) | pulumi/agent-skills |
| [`pulumi-cdk-to-pulumi`](./pulumi-cdk-to-pulumi) | pulumi/agent-skills |
| [`pulumi-terraform-to-pulumi`](./pulumi-terraform-to-pulumi) | pulumi/agent-skills |
| [`cloudformation-to-pulumi`](./cloudformation-to-pulumi) | pulumi/agent-skills |
| [`pulumi-upgrade-provider`](./pulumi-upgrade-provider) | pulumi/agent-skills |
| [`upstream-patches`](./upstream-patches) | pulumi/agent-skills |

## Install

### Via `npx` (skill symlinks)

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

### Via Nix flake (CLI tools)

Some skills ship runnable tools. The flake exposes them as packages:

```sh
nix run github:bpavlo/agent-skills#oc-context -- stats
```

Or as a flake input from your own config:

```nix
inputs.agent-skills.url = "github:bpavlo/agent-skills";
# then in home.packages:
inputs.agent-skills.packages.${pkgs.system}.oc-context
```

## License

Original skills (`lua-vibe`, `nix-vibe`, `oc-context`) and repo tooling: MIT,
see [LICENSE](./LICENSE). Vendored skills retain their upstream licenses (MIT /
Apache-2.0 — see [SOURCES.md](./SOURCES.md) and each skill's own files).
