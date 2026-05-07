# agent-skills

Personal skills for AI coding agents (Claude Code, opencode, Cursor, etc.). Each
directory at the root is one skill, ready to be loaded by an agent that supports
the [skill protocol convention](https://github.com/anthropics/anthropic-cookbook)
— a `SKILL.md` with YAML frontmatter plus an optional `references/` directory
for deep-dive material.

## Skills

| Skill | Description |
|---|---|
| [`nix-vibe`](./nix-vibe) | Best practices for structuring Nix flakes and NixOS / nix-darwin / home-manager configurations. Distilled from mitchellh/nixos-config, Misterio77/nix-starter-configs, ryan4yin/nix-config, sioodmy/dotfiles, and Mic92/sops-nix. |

More skills coming.

## Installation

Skills install by symlinking each directory into `~/.agents/skills/`. That is
the convention used by Claude Code and opencode for personal skills.

### Quick install

```sh
git clone https://github.com/bpavlo/agent-skills ~/code/agent-skills
~/code/agent-skills/install.sh
```

The `install.sh` script symlinks every top-level skill directory into
`~/.agents/skills/<skill>`. It also creates a parallel symlink at
`~/.claude/skills/<skill>` if that directory exists, so the skill is visible to
both Claude Code and opencode.

### Manual install

```sh
ln -s ~/code/agent-skills/nix-vibe ~/.agents/skills/nix-vibe
```

### Install a single skill

```sh
~/code/agent-skills/install.sh nix-vibe
```

### Uninstall

```sh
~/code/agent-skills/install.sh --uninstall          # removes all skill symlinks
~/code/agent-skills/install.sh --uninstall nix-vibe # removes one
```

## Skill anatomy

```
<skill-name>/
├── SKILL.md           # required — YAML frontmatter + skill body
├── use_cases.yaml     # optional — trigger phrases for skill router
├── references/        # optional — deep-dive docs the agent loads on demand
│   ├── topic-1.md
│   └── topic-2.md
├── scripts/           # optional — helper scripts the agent may execute
└── templates/         # optional — copy-pasteable starting points
```

`SKILL.md` frontmatter looks like:

```yaml
---
name: my-skill
version: 1.0.0
description: One-paragraph summary that triggers the skill loader. Mention the
  domain, the tasks the skill helps with, and the keywords agents should match.
---
```

Keep `description` punchy — it is what the agent's skill router reads to decide
whether to load the skill. Reference the full body via `SKILL.md` headings.

## Authoring a new skill

1. Pick a name. Lowercase, hyphenated, descriptive (`nix-vibe`, `lua-vibe`,
   `terraform-modules`).
2. Create `<name>/SKILL.md` with the frontmatter above and a "When to Use This
   Skill" section.
3. Distill patterns from real-world references. Cite the sources.
4. Split anything >300 lines into a `references/<topic>.md` and link to it from
   `SKILL.md`.
5. Run `./install.sh <name>` and verify the skill loads in your agent.
6. Open a PR.

## License

MIT. See [LICENSE](./LICENSE).
