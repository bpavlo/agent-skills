# agent-skills

Personal skills for AI coding agents (Claude Code, opencode, Cursor, etc.).
Each top-level directory is one skill, ready to be loaded by an agent that
follows the [skill protocol convention](https://github.com/anthropics/anthropic-cookbook):
a `SKILL.md` with YAML frontmatter plus an optional `references/` directory for
deep-dive material.

## Skills

| Skill | Description |
|---|---|
| [`nix-vibe`](./nix-vibe) | Best practices for Nix flakes and NixOS / nix-darwin / home-manager. Distilled from mitchellh/nixos-config, Misterio77/nix-starter-configs, ryan4yin/nix-config, sioodmy/dotfiles, and Mic92/sops-nix. |

More on the way.

## Install

Requires Node ≥ 18 and `git`. The CLI clones this repo into
`~/.local/share/agent-skills` (or `$XDG_DATA_HOME/agent-skills`) and symlinks
each skill into `~/.agents/skills/<name>` (and `~/.claude/skills/<name>` if
that directory exists, so the same install covers both opencode and Claude
Code).

```sh
# install everything
npx github:bpavlo/agent-skills install

# install a specific skill
npx github:bpavlo/agent-skills install nix-vibe

# pull the latest changes
npx github:bpavlo/agent-skills update

# list installable skills
npx github:bpavlo/agent-skills list

# remove symlinks (all or named)
npx github:bpavlo/agent-skills uninstall
npx github:bpavlo/agent-skills uninstall nix-vibe

# show the on-disk install dir
npx github:bpavlo/agent-skills path
```

`npx` will prompt to download the package the first time. After that the CLI
runs from npm's cache; the actual skill content lives at the path printed by
`agent-skills path`.

## Skill anatomy

```
<skill-name>/
├── SKILL.md           # required — YAML frontmatter + skill body
├── use_cases.yaml     # optional — trigger phrases for the skill router
├── references/        # optional — deep-dive docs the agent loads on demand
├── scripts/           # optional — helper scripts the agent may execute
└── templates/         # optional — copy-pasteable starting points
```

`SKILL.md` frontmatter:

```yaml
---
name: my-skill
version: 1.0.0
description: One-paragraph summary that the skill router reads to decide
  whether to load the skill. Mention the domain, the tasks the skill helps
  with, and the keywords agents should match.
---
```

Keep `description` punchy — it is what the router sees. The full body lives
under `SKILL.md` headings; long form goes in `references/<topic>.md`.

## Authoring a new skill

1. Pick a name. Lowercase, hyphenated, descriptive (`nix-vibe`, `lua-vibe`,
   `terraform-modules`).
2. Create `<name>/SKILL.md` with the frontmatter above and a "When to Use This
   Skill" section.
3. Distill patterns from real-world references. Cite sources.
4. Split anything over ~300 lines into `references/<topic>.md` and link to it
   from `SKILL.md`.
5. Add an entry to the **Skills** table in this README.
6. Commit, push, then `npx github:bpavlo/agent-skills update` on each machine
   you've installed on.

## Develop locally

If you want edits to propagate without pushing first, point the install dir at
your working clone:

```sh
git clone git@github.com:bpavlo/agent-skills.git ~/code/agent-skills
ln -s ~/code/agent-skills ~/.local/share/agent-skills
npx github:bpavlo/agent-skills install
```

The CLI is a no-op `git pull` (already up to date) and the symlinks resolve
through your clone, so editing files under `~/code/agent-skills/` is reflected
immediately in `~/.agents/skills/`.

## License

MIT. See [LICENSE](./LICENSE).
