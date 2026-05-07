---
name: nix-vibe
version: 1.0.0
description: Best practices for structuring Nix flakes and NixOS/nix-darwin/home-manager configurations. Use when writing, reviewing, refactoring, or scaffolding Nix configs; designing flake outputs (mkSystem, specialArgs); organizing modules, hosts, and users; managing secrets with sops-nix or agenix; layering overlays; building multi-host setups; bootstrapping with disko; or evolving an existing nix-config repo.
---

# nix-vibe — Nix Configuration Best Practices

## When to Use This Skill

Load this skill whenever the task involves:

- Writing a new flake (`flake.nix`, `flake.lock`) for NixOS, nix-darwin, or home-manager.
- Refactoring an existing nix-config (e.g. growing from one host to many, splitting a megafile into modules).
- Reviewing someone's flake structure or pointing out anti-patterns.
- Choosing a secrets backend (sops-nix vs agenix) and wiring it correctly.
- Designing the `mkSystem` / `mkHost` helper, `specialArgs`, overlays, and module composition.
- Adding a host, user, overlay, custom package, or feature module.
- Bootstrapping a fresh machine with `disko`, secure boot, encrypted disks.
- Setting up `home-manager` (integrated as a NixOS module vs standalone `homeConfigurations`).
- Writing a `Makefile`/`Justfile` entry-point and a CI check (`nix flake check`, `pre-commit`).
- Evolving an aesthetic/rice config (theming, Hyprland, GTK).

The skill is opinionated: it prefers small, self-contained patterns from real-world configs over heavyweight frameworks like flake-parts. The opinions are taken from the most-cited public configs (mitchellh, ryan4yin, Misterio77, sioodmy) and the official sops-nix README.

## Source Material

This skill distills patterns from:

- **mitchellh/nixos-config** — the "deliberately simple" reference. One `mkSystem` helper, no flake-parts, no haumea, no agenix. Target audience: solo dev, 1-3 hosts.
- **Misterio77/nix-starter-configs** — the official-feeling starter templates (`minimal/`, `standard/`). The source of the canonical "additions / modifications / unstable-packages" overlay pattern.
- **ryan4yin/nix-config** — the "every pattern at once" reference. Multi-host, multi-platform, k8s, colmena, eval tests, haumea-loaded outputs, central `vars/`.
- **sioodmy/dotfiles** — the rice / aesthetic reference. Single `theme` attrset threaded via `specialArgs`, binary wrapping with `symlinkJoin` + `wrapProgram`, custom `toHyprConf`.
- **Mic92/sops-nix** — the secrets backend reference. Treated as authoritative for secrets workflow.

Reference docs in `references/` capture the verbatim code patterns.

## Core Philosophy

These principles are evaluated in order. Each later principle assumes the earlier ones.

### 1. The flake is a manifest, not a script

`flake.nix` should declare inputs and one or two thin entry points. Logic lives in module files, helper libraries, or an `outputs/` directory. The two acceptable shapes are:

```nix
# Style A (mitchellh): inline outputs are fine for ≤5 hosts.
outputs = { self, nixpkgs, ... }@inputs: let
  mkSystem = import ./lib/mksystem.nix { inherit nixpkgs inputs; };
in {
  nixosConfigurations.phoenix = mkSystem "phoenix" { system = "x86_64-linux"; user = "pavlo"; };
};
```

```nix
# Style B (ryan4yin): a directory becomes the outputs for ≥5 hosts or multi-platform.
outputs = inputs: import ./outputs inputs;
```

Avoid: putting `nixpkgs.lib.nixosSystem { ... }` directly in `flake.nix` once you have a second host. That's the call site that begs to be deduplicated.

### 2. One helper, dispatch on flags

Build NixOS, nix-darwin, and (optionally) WSL hosts through a single `mkSystem` helper that accepts boolean flags. See `references/flake-architecture.md` for the canonical implementation. Three flags suffice for almost all configs: `darwin`, `wsl`, and the derived `isLinux = !darwin && !wsl`.

### 3. Filesystem convention over configuration

Find host configs by name:

```nix
machineConfig = ../hosts/${name}.nix;        # or ../hosts/${name}/default.nix
userOSConfig  = ../users/${user}/${if darwin then "darwin" else "nixos"}.nix;
userHMConfig  = ../users/${user}/home-manager.nix;
```

Adding a host = drop a file into `hosts/`. No central manifest of hostnames.

### 4. Inputs follow `nixpkgs` aggressively

Every input that has its own `nixpkgs` input must `follows = "nixpkgs"`:

```nix
home-manager.inputs.nixpkgs.follows = "nixpkgs";
sops-nix.inputs.nixpkgs.follows = "nixpkgs";
disko.inputs.nixpkgs.follows = "nixpkgs";
```

This shrinks the closure, keeps eval cache hot, and prevents version skew. The only exception is when an upstream explicitly recommends *against* it (very rare; document inline if so).

### 5. `_module.args` and `specialArgs` for cross-cutting context

Pass context (inputs, theme, host metadata) to every module via `specialArgs` or `_module.args`. Don't `import` and thread args through every call:

```nix
# In mkSystem:
specialArgs = { inherit inputs mylib myvars; theme = import ../theme pkgs; };

# In any module:
{ inputs, mylib, theme, ... }: { config = { ... }; }
```

### 6. Stable + unstable + master via overlays, not separate `pkgs` instances

Don't `import nixpkgs { ... }` repeatedly across modules. Either use the [`additions / modifications / unstable-packages`](references/overlays-and-packages.md) three-overlay pattern (Misterio77 style) or expose multiple `pkgs-*` via `specialArgs` (ryan4yin style). Pick one and stay consistent.

### 7. Secrets are encrypted in the repo, decrypted at activation

Never commit cleartext secrets. Pick **sops-nix** (default for new configs) or **agenix** (simpler when one secret = one file). Bind decryption to host SSH ed25519 keys via `ssh-to-age`. See `references/secrets.md`.

### 8. Home-manager is integrated, not a parallel reality

Wire home-manager *inside* `mkSystem` so the user's HM config and OS config share `pkgs`, `inputs`, and `specialArgs`. Reserve standalone `homeConfigurations` for non-NixOS Linux (Ubuntu, Fedora) or remote machines you don't own.

### 9. Options-driven feature modules

Each module under `modules/` defines `options.modules.<area>.<feature>.enable` and gates everything in `config = lib.mkIf cfg.enable { ... }`. Per-host files become tiny:

```nix
# hosts/phoenix/default.nix
{
  modules.desktop.gnome.enable = true;
  modules.desktop.gaming.enable = true;
  modules.secrets.workstation.enable = true;
}
```

### 10. Keep `flake-utils` and `flake-parts` out unless you need them

`nixpkgs.lib.genAttrs` plus a hand-written `forAllSystems` covers 95% of `flake-utils` use cases. `flake-parts` solves a real problem (multi-output composition for libraries) but is overkill for personal configs. Adopt only when you can articulate which pain it solves for *your* repo.

## Reference Documents

Load these when the task touches the corresponding area. Each is self-contained.

| File | Topic |
|---|---|
| `references/flake-architecture.md` | `flake.nix` shapes, `mkSystem`, `specialArgs`, `_module.args`, the `outputs/` directory pattern |
| `references/module-organization.md` | `modules/` vs `hosts/` vs `users/`, options-driven modules, `mylib.scanPaths` autoloading |
| `references/home-manager.md` | Integrated vs standalone, `useGlobalPkgs`, dotfile strategies (`readFile`, `mkOutOfStoreSymlink`, binary wrapping) |
| `references/secrets.md` | Full sops-nix workflow, agenix alternative, comparison matrix, `.sops.yaml` examples, host bootstrap, common pitfalls |
| `references/overlays-and-packages.md` | The `additions / modifications / unstable-packages` triad, custom `pkgs/`, multiple `pkgs-*` |
| `references/multi-host-and-deploy.md` | Centralized `vars/`, derived `networking.interfaces`, colmena, deploy-rs, Makefile/Justfile entry points |
| `references/theming.md` | `theme` attrset via specialArgs, base16 + named colors, binary wrapping with `symlinkJoin` |
| `references/bootstrap-and-disks.md` | `disko` declarative disks, secure boot (Lanzaboote), TPM2 LUKS unlock, fresh-install workflow |
| `references/anti-patterns.md` | What NOT to do — beginner traps, over-engineering, common mistakes |
| `references/templates.md` | Copy-pasteable starting points (small flake, large flake, sops.yaml, mksystem.nix, justfile) |

## Workflow: Common Tasks

### Task A — Scaffold a new flake

1. Decide scope: single host (use `references/templates.md` minimal) or multi-host (use the full template).
2. Pin `nixpkgs` to a release channel (`nixos-25.11`), not unstable, unless the user explicitly wants unstable.
3. Set `home-manager.inputs.nixpkgs.follows = "nixpkgs"` on every input.
4. Write `flake.nix` with minimal logic + `lib/mksystem.nix` (or `outputs/default.nix` for ≥5 hosts).
5. Add one host file under `hosts/<hostname>/default.nix` and one user file under `users/<username>/`.
6. Verify with `nix flake check` and `nix build .#nixosConfigurations.<host>.config.system.build.toplevel --dry-run`.

### Task B — Add a host to an existing config

1. Run `nixos-generate-config --no-filesystems` on the new machine; copy `hardware-configuration.nix` to `hosts/<hostname>/`.
2. If using `disko`, write `hosts/<hostname>/disko.nix`.
3. Add one entry in `flake.nix` (or one file under `outputs/<system>/src/`).
4. Re-key sops/agenix files for the new host's age key (`ssh-to-age` then `sops updatekeys`).
5. Verify build before deploy: `nixos-rebuild build --flake .#<hostname>`.

### Task C — Add a secret

1. Pick the right `.sops.yaml` `creation_rules` entry (per-host, per-user, or shared).
2. `sops secrets/<host>/secrets.yaml` to edit.
3. Declare in NixOS: `sops.secrets.<name> = { owner = ...; mode = "0400"; restartUnits = [ "x.service" ]; };`.
4. Consume via `${config.sops.secrets.<name>.path}` (never inline the value — it's not available at eval time).
5. Rebuild and verify `/run/secrets/<name>` exists with correct ownership.

See `references/secrets.md` for the full workflow including `neededForUsers` for declarative login passwords.

### Task D — Refactor a megafile into modules

1. Identify the natural seams: desktop, gaming, networking, audio, virtualization.
2. Create `modules/<area>/<feature>.nix` with `options.modules.<area>.<feature>.enable` and `config = lib.mkIf cfg.enable { ... }`.
3. Auto-import via `mylib.scanPaths ./modules` (see `references/module-organization.md`).
4. Move host files to `imports = [ ./modules ]; modules.<area>.<feature>.enable = true;`.
5. Verify each step with `nixos-rebuild build` — a refactor that doesn't change closure size is a successful refactor.

### Task E — Review someone's flake

Use `references/anti-patterns.md` as a checklist. Top items to flag:

- `flake-utils` used purely for `genAttrs` (replace with `nixpkgs.lib.genAttrs`).
- Inputs without `follows = "nixpkgs"`.
- Cleartext secrets, `.env` committed, `pass`/`gpg` invocations at eval time.
- `with pkgs;` in long lists (slower eval, shadowing risk).
- `import nixpkgs { ... }` repeated in modules instead of using overlays/specialArgs.
- A `flake.nix` longer than ~80 lines without an obvious helper.
- Single-tenant `mutableUsers = false;` without a recovery plan.
- Hardcoded paths (`/home/<user>/foo`) instead of `config.home.homeDirectory`.

## Verification Commands

Run these after Nix changes:

```bash
nix flake check                                              # eval + checks
nix fmt                                                       # treefmt-nix or nixfmt
nix build .#nixosConfigurations.<host>.config.system.build.toplevel --dry-run
nix build .#darwinConfigurations.<host>.system --dry-run     # nix-darwin
nix eval .#nixosConfigurations.<host>.config.environment.systemPackages --apply 'p: builtins.length p'
sudo nixos-rebuild test --flake .#<host>                     # activate without committing to boot
sudo nixos-rebuild switch --flake .#<host>                   # commit
```

Optional but valuable:

```bash
nix run nixpkgs#nix-tree -- ".#nixosConfigurations.<host>.config.system.build.toplevel"
nix run nixpkgs#nvd -- diff /run/current-system result        # diff before activation
nix run nixpkgs#deadnix -- .                                  # find dead Nix code
nix run nixpkgs#statix -- check .                             # lint
```

## Communication Style

When applying this skill:

- State which patterns you're using ("This uses the Misterio77 three-overlay pattern" / "This is the ryan4yin outputs/ split").
- Never invent a pattern not present in the source repos without saying so. Point to the verbatim source if challenged.
- Prefer the smallest correct change. If the user has a working `flake.nix` for one host, do not propose `outputs/default.nix` unless they're growing past 3-4 hosts.
- Push back when an idiom doesn't fit. Example: rice configs use `theme` via `specialArgs`; for a multi-user professional config, prefer typed `options.theme.*` instead.
- Distinguish `# Opinionated:` defaults (e.g. `nix.channel.enable = false;`) so the user can opt out.
- Run `nix flake check` and `nix fmt` after edits when the environment supports it. Report results explicitly.

## Anti-Patterns at a Glance

The full list is in `references/anti-patterns.md`. Five hard rules:

1. **Never put secrets in `flake.nix` or in any `.nix` file that gets committed.** Use sops-nix or agenix.
2. **Never `import nixpkgs` more than twice in a flake.** Two is acceptable for "stable + unstable" — more means you've lost track.
3. **Never use `flake-utils` *and* hand-rolled `genAttrs` in the same flake.** Pick one.
4. **Never write `with pkgs;` over more than 8 packages.** Use `inherit (pkgs) a b c;` or list them explicitly.
5. **Never hardcode `username` / `hostname` / `email` in more than one place.** Centralize in `vars/default.nix` (ryan4yin style) or pass via `specialArgs`.
