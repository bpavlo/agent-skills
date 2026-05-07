# Anti-Patterns

What NOT to do. Each item lists detection signals, why it's bad, and the right pattern.

## 1. Cleartext secrets in `.nix` files or git

**Signal:** API keys, passwords, tokens hardcoded in any `.nix` file. `.env` files committed.

**Why it's bad:** Git history is forever. Even if you remove the secret in a later commit, it lives in `git log -p`. Public repos leak instantly to GitHub secret scanners (and bots).

**Right pattern:**

- For per-host service secrets: sops-nix or agenix. See `secrets.md`.
- For ssh-style admin secrets you carry around: pass / 1Password / Bitwarden CLI; reference via `op://` URIs in `home.sessionVariables`.
- For LUKS keyfiles: TPM2 + recovery passphrase, never committed.
- For initial install: temp keyfile under `/tmp/secret.key`, rotate immediately.

## 2. `with pkgs;` over long lists

**Signal:**

```nix
environment.systemPackages = with pkgs; [
  bat eza fd fzf git htop jq lazygit ncdu ripgrep starship tree zoxide
  firefox chromium discord obsidian slack zoom-us
  vscode jetbrains.idea-ultimate
];
```

**Why it's bad:**

1. `with` introduces every name in `pkgs` into scope, slowing eval.
2. Shadowing risk — if a local `let` binding has the same name as a package, debugging is painful.
3. `nil`/`statix` warn on it; tooling has trouble inferring types.

**Right pattern:**

```nix
environment.systemPackages = builtins.attrValues {
  inherit (pkgs)
    bat eza fd fzf git htop jq lazygit ncdu ripgrep starship tree zoxide
    firefox chromium discord obsidian slack zoom-us
    vscode;
} ++ [ pkgs.jetbrains.idea-ultimate ];
```

For short lists (≤5), `with pkgs; [ git htop ]` is fine.

## 3. `import nixpkgs { ... }` inside a module

**Signal:**

```nix
{ pkgs, inputs, ... }:
let
  unstable = import inputs.nixpkgs-unstable {
    system = pkgs.system;
    config.allowUnfree = true;
  };
in
{
  environment.systemPackages = [ unstable.firefox ];
}
```

**Why it's bad:** Re-imports nixpkgs for every module that does it. Slow eval. Doubled closure.

**Right pattern:**

- Use the [`unstable-packages` overlay](overlays-and-packages.md) so `pkgs.unstable` is available.
- Or expose `pkgs-unstable` via `specialArgs` so modules just take it as an arg.

## 4. Inputs without `follows = "nixpkgs"`

**Signal:**

```nix
inputs.home-manager.url = "github:nix-community/home-manager/release-25.11";
# Missing: home-manager.inputs.nixpkgs.follows = "nixpkgs";
```

**Why it's bad:** home-manager pulls its own nixpkgs. Eval time doubles. Closure size doubles. Risk of subtle version skew (your `pkgs.firefox` differs from HM's `pkgs.firefox`).

**Right pattern:** every input that has `inputs.nixpkgs` (check via `nix flake metadata`) must have `inputs.X.nixpkgs.follows = "nixpkgs"`. Document inline if there's a rare exception.

## 5. Hardcoded paths and identifiers

**Signal:**

```nix
xdg.configFile."myapp".source = "/home/pavlo/dotfiles/myapp.conf";
home.username = "pavlo";
networking.hostName = "phoenix";              # in shared module, not host file
users.users.pavlo.openssh.authorizedKeys.keys = [ "ssh-ed25519 AAA..." ];
```

**Why it's bad:** Not portable across hosts/users. When you add a second user or rename, you grep across the repo and miss instances.

**Right pattern:** centralize in `vars/default.nix`:

```nix
# vars/default.nix
{
  username = "pavlo";
  authorizedKeys = [ "ssh-ed25519 AAA..." ];
}
```

```nix
# Module
{ myvars, currentSystemName, ... }:
{
  networking.hostName = currentSystemName;
  users.users.${myvars.username}.openssh.authorizedKeys.keys = myvars.authorizedKeys;
  xdg.configFile."myapp".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/nix-config/dotfiles/myapp.conf";
}
```

## 6. `flake-utils` purely for `eachDefaultSystem`

**Signal:**

```nix
inputs.flake-utils.url = "github:numtide/flake-utils";
# ...
outputs = { self, nixpkgs, flake-utils, ... }:
  flake-utils.lib.eachDefaultSystem (system:
    let pkgs = nixpkgs.legacyPackages.${system}; in {
      packages.default = pkgs.hello;
    }
  );
```

**Why it's bad:** Adds an input + a flake.lock entry for one helper that's 3 lines.

**Right pattern:**

```nix
outputs = { self, nixpkgs, ... }: let
  systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
  forAllSystems = nixpkgs.lib.genAttrs systems;
in {
  packages = forAllSystems (system: {
    default = nixpkgs.legacyPackages.${system}.hello;
  });
};
```

Adopt `flake-utils` only if you also use its other helpers (`mkApp`, `mkShell` builders).

## 7. `flake-parts` for a personal config

**Signal:** A single-user config uses flake-parts to compose multiple "modules" of a flake.

**Why it's bad:** flake-parts solves a real problem — reusable flake module composition for **published libraries** that contribute parts of multiple flakes. For personal configs, it adds indirection without saving lines.

**Right pattern:** stick with hand-rolled `outputs/` directory pattern (ryan4yin) or inline outputs (mitchellh). Adopt flake-parts only when:

- You're publishing a flake module others should consume.
- Your flake exposes ≥4 distinct output domains (packages, NixOS modules, HM modules, devShells, checks, formatter) and they have non-trivial composition.

## 8. `mutableUsers = false` without recovery plan

**Signal:**

```nix
users.mutableUsers = false;
users.users.pavlo.hashedPassword = "$y$jFT$...";
```

**Why it's bad:** If you lose access to the password, you cannot `passwd` your way out. The repo is the only authority.

**Right pattern:**

- Have at least one out-of-band recovery method (LUKS passphrase, USB recovery key, second admin user).
- Or use `hashedPasswordFile` with sops-nix `neededForUsers` so password changes don't require rebuild.
- Or use `initialPassword`/`initialHashedPassword` (mutable after first set).

## 9. Multiple sources of truth for `pkgs`

**Signal:** Your config has both:

```nix
# In flake.nix — overlay-based unstable
overlays = [ (final: prev: { unstable = import inputs.nixpkgs-unstable {...}; }) ];

# In a module — specialArgs-based unstable
{ pkgs-unstable, ... }: { ... }
```

**Why it's bad:** Two ways to access the same thing. New contributors don't know which to use. Refactoring is risky.

**Right pattern:** pick one. Document it in your repo's `AGENTS.md` or `CLAUDE.md`.

## 10. `nixos-rebuild switch` without `build` first

**Signal:** Workflow goes: edit → `nixos-rebuild switch`.

**Why it's bad:** A failed activation can leave the system half-broken. Boot generations protect you, but it's a hassle.

**Right pattern:**

```bash
# Always build first to catch eval errors / package failures
nixos-rebuild build --flake .#phoenix

# Test (activate without committing to next boot)
sudo nixos-rebuild test --flake .#phoenix

# Once verified, switch
sudo nixos-rebuild switch --flake .#phoenix
```

Or use `nh` (nix-helper) which combines build + diff + activate.

## 11. Modules that don't use options

**Signal:**

```nix
# modules/desktop/gnome.nix
{ ... }:
{
  services.xserver.enable = true;
  services.xserver.displayManager.gdm.enable = true;
  services.xserver.desktopManager.gnome.enable = true;
}
```

This is unconditionally applied to every host that imports it.

**Why it's bad:** Every host either gets the full module or nothing. No way to opt out of one piece. Refactoring requires editing the module file, not the host.

**Right pattern:**

```nix
{ config, lib, pkgs, ... }:
let cfg = config.modules.desktop.gnome; in
{
  options.modules.desktop.gnome.enable = lib.mkEnableOption "GNOME";

  config = lib.mkIf cfg.enable {
    services.xserver.enable = true;
    services.xserver.displayManager.gdm.enable = true;
    services.xserver.desktopManager.gnome.enable = true;
  };
}
```

Then host files become tiny:

```nix
modules.desktop.gnome.enable = true;
```

## 12. Dotfiles translated 1:1 into Nix attrsets

**Signal:** A 200-line `programs.i3 = { config = { keybindings = { ... }; ... }; ... };` block that mirrors `i3-config` syntax in Nix attrs.

**Why it's bad:** Twice the surface area to debug. The official i3 docs don't help — you have to translate every example. Errors fail at eval time with cryptic messages.

**Right pattern:** keep the dotfile as a plain text file alongside the Nix:

```nix
xdg.configFile."i3/config".source = ./dotfiles/i3-config;
```

Or, for live-editing:

```nix
xdg.configFile."i3/config".source =
  config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/nix-config/dotfiles/i3-config";
```

The exception is when HM's typed module is genuinely better than the upstream config (e.g. `programs.git`, where HM normalizes signing/aliases nicely).

## 13. `nix-shell -p` instead of `devShell`

**Signal:** Project README says "you need to install jq and ripgrep first".

**Why it's bad:** Onboarding friction. Versions drift. Tooling invocation isn't reproducible.

**Right pattern:** `flake.nix` exposes a `devShells.default`:

```nix
devShells = forAllSystems (system:
  let pkgs = nixpkgs.legacyPackages.${system}; in {
    default = pkgs.mkShell {
      packages = with pkgs; [ jq ripgrep nixfmt deadnix statix ];
    };
  }
);
```

Plus an `.envrc`:

```bash
use flake
```

Now `direnv allow` activates the shell automatically.

## 14. Bumping `system.stateVersion`

**Signal:** Comment says "I bumped this because the latest is X".

**Why it's bad:** `system.stateVersion` (and `home.stateVersion`) are explicitly **not** "the version you want to run". They lock NixOS/HM behavior to the version you first installed under, so subsequent upgrades don't break stateful things (database formats, default options).

**Right pattern:** set it once at install time, **never bump**. If a release note says "you must bump stateVersion", read carefully — usually it's wrong advice. The correct version is the one you installed under.

## 15. Mixing `nix-channel` and flakes

**Signal:** `/etc/nixos/configuration.nix` exists alongside a flake. `nix-channel --list` shows entries.

**Why it's bad:** Two sources of truth for `pkgs`. Subtle differences between `nixos-rebuild` with and without `--flake`.

**Right pattern:** go all-in on flakes:

```nix
nix.settings.experimental-features = [ "nix-command" "flakes" ];
nix.channel.enable = false;          # disable nix-channel entirely
nix.settings.flake-registry = "";    # disable global registry
```

Remove `/etc/nixos/configuration.nix` after the first successful flake-based rebuild.

## 16. Forgetting `nix.settings.trusted-users`

**Signal:** `nix copy` from a remote builder requires sudo. `direnv` warnings about substituters.

**Why it's bad:** Default `trusted-users = [ "root" ]` is overly conservative. Your user can't push to caches, can't add substituters via `nix.conf` overrides.

**Right pattern:**

```nix
nix.settings = {
  trusted-users = [ "root" "@wheel" ];
  substituters = [
    "https://cache.nixos.org"
    "https://nix-community.cachix.org"
  ];
  trusted-public-keys = [
    "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
    "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
  ];
};
```

## 17. Custom `lib` that re-exports `lib.attrsets`

**Signal:**

```nix
# lib/attrs.nix — anti-example from a real config
{ lib, ... }: {
  listToAttrs = lib.genAttrs;
  inherit (lib.attrsets) mapAttrs mapAttrs' mergeAttrsList foldlAttrs;
}
```

**Why it's bad:** Adds an indirection layer that helps no one. You still need to know what these functions do; you just import them under a different name.

**Right pattern:** use `lib.attrsets.mergeAttrsList` directly. Reserve `mylib` for genuine helpers (`relativeToRoot`, `scanPaths`, `mkSystem`).

## 18. Per-host overlays

**Signal:**

```nix
# hosts/phoenix/default.nix
nixpkgs.overlays = [
  (final: prev: { firefox = prev.firefox.override {...}; })
];
```

**Why it's bad:** Overlays scattered across hosts means you can't audit what's modified globally. Different hosts get different `pkgs.firefox`.

**Right pattern:** one place for overlays — `overlays/default.nix` (or inline in `flake.nix`). Apply uniformly via `mkSystem`.

## 19. Ignoring `nix flake check` failures

**Signal:** `nix flake check` fails but the user says "I'll fix it later".

**Why it's bad:** Failures stack. By the time you address them, the cause is buried under 10 commits.

**Right pattern:** treat `nix flake check` as the build gate. Run it in pre-commit or CI. Fix immediately.

## 20. Single-host config for >1 user without `users/`

**Signal:** `users.users.alice = {...}; users.users.bob = {...};` inline in `configuration.nix`, with their HM configs as inline `home-manager.users.alice = { ... };` blocks.

**Why it's bad:** No separation between user-specific config and host-specific config. Each user's settings are spread across files.

**Right pattern:** one directory per user under `users/<name>/`. `mkSystem` accepts a `user` argument and finds the user's config by convention.

## Quick Code-Review Checklist

When reviewing a Nix flake, check:

- [ ] No secrets in any committed `.nix` file.
- [ ] Every input with its own `nixpkgs` has `follows = "nixpkgs"`.
- [ ] One `mkSystem` (or equivalent) helper, not duplicate `nixpkgs.lib.nixosSystem` calls.
- [ ] `flake.nix` is <100 lines, or uses `outputs = inputs: import ./outputs inputs`.
- [ ] `home-manager.useGlobalPkgs = true` in integrated mode.
- [ ] Modules use `options.modules.<area>.<feature>.enable` and gate with `mkIf`.
- [ ] No `with pkgs;` over >8 packages.
- [ ] No `import nixpkgs { ... }` inside a non-flake module.
- [ ] `vars/` (or equivalent) is the single source for username, email, password hash, SSH keys.
- [ ] Disk layout in `disko.nix`, not partitioning instructions in README.
- [ ] `nix flake check` passes.
- [ ] `treefmt.nix` or `nix fmt` produces no changes (formatting clean).
