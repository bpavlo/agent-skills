# Flake Architecture

This document covers `flake.nix` shape, the `mkSystem` helper, `specialArgs`/`_module.args` propagation, and when to graduate from inline outputs to an `outputs/` directory.

## The Two Acceptable Shapes

### Shape A — Inline outputs (≤5 hosts, single platform family)

Inspired by **mitchellh/nixos-config**. Suitable when you have one or two hosts and they share most config. The flake itself is ~80-100 lines.

```nix
{
  description = "Personal nix configuration";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.11";
    nixpkgs-unstable.url = "github:nixos/nixpkgs/nixpkgs-unstable";

    home-manager.url = "github:nix-community/home-manager/release-25.11";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";

    darwin.url = "github:nix-darwin/nix-darwin/nix-darwin-25.11";
    darwin.inputs.nixpkgs.follows = "nixpkgs";

    sops-nix.url = "github:Mic92/sops-nix";
    sops-nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, home-manager, darwin, ... }@inputs: let
    overlays = [
      (final: prev: {
        unstable = inputs.nixpkgs-unstable.legacyPackages.${prev.system};
      })
    ];
    mkSystem = import ./lib/mksystem.nix { inherit overlays nixpkgs inputs; };
  in {
    nixosConfigurations.phoenix = mkSystem "phoenix" {
      system = "x86_64-linux";
      user = "pavlo";
    };

    darwinConfigurations.jade = mkSystem "jade" {
      system = "aarch64-darwin";
      user = "pavlo";
      darwin = true;
    };
  };
}
```

### Shape B — `outputs/` directory (≥5 hosts, multi-platform)

Inspired by **ryan4yin/nix-config**. The flake itself becomes a one-liner.

```nix
{
  description = "Personal nix configuration";

  outputs = inputs: import ./outputs inputs;

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.11";
    home-manager.url = "github:nix-community/home-manager/release-25.11";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
    # ... other inputs
  };
}
```

Then `outputs/default.nix` builds `genSpecialArgs`, dispatches to per-system subdirectories, and merges results. See `multi-host-and-deploy.md` for the full skeleton.

## The Canonical `mkSystem`

This is **`lib/mksystem.nix`** — adapted from mitchellh, modernized. Place under `lib/mksystem.nix`. It is the single most important helper in any non-trivial flake.

```nix
# lib/mksystem.nix
{ nixpkgs, overlays, inputs }:

name:
{
  system,
  user,
  darwin ? false,
  wsl ? false,
}:

let
  isWSL = wsl;
  isLinux = !darwin && !isWSL;

  hostConfig = ../hosts/${name};
  userOSConfig = ../users/${user}/${if darwin then "darwin" else "nixos"}.nix;
  userHMConfig = ../users/${user}/home-manager.nix;

  systemFunc =
    if darwin then inputs.darwin.lib.darwinSystem
    else nixpkgs.lib.nixosSystem;

  homeManagerModule =
    if darwin then inputs.home-manager.darwinModules.home-manager
    else inputs.home-manager.nixosModules.home-manager;

  inherit (nixpkgs.lib) optionals;
in
systemFunc {
  inherit system;
  specialArgs = {
    inherit inputs;
    currentSystem = system;
    currentSystemName = name;
    currentSystemUser = user;
    isWSL = isWSL;
    isLinux = isLinux;
    isDarwin = darwin;
  };

  modules =
    [
      { nixpkgs.overlays = overlays; }
      { nixpkgs.config.allowUnfree = true; }
    ]
    ++ optionals isWSL [ inputs.nixos-wsl.nixosModules.wsl ]
    ++ [
      hostConfig
      userOSConfig
      homeManagerModule
      {
        home-manager.useGlobalPkgs = true;
        home-manager.useUserPackages = true;
        home-manager.backupFileExtension = "hm-backup";
        home-manager.extraSpecialArgs = {
          inherit inputs isWSL isLinux;
          isDarwin = darwin;
        };
        home-manager.users.${user} = import userHMConfig;
      }
    ];
}
```

Key properties:

1. **One helper, three platforms.** NixOS, nix-darwin, and WSL go through the same call site — only the boolean flags differ.
2. **Conventional file lookups.** The `name` argument is the directory name under `hosts/`. The `user` argument is the directory name under `users/`. No central manifest required.
3. **`specialArgs` for OS modules, `extraSpecialArgs` for home-manager.** Both get `inputs`, plus host-derived booleans and metadata.
4. **`useGlobalPkgs = true`** lets home-manager share the system's `nixpkgs` (overlays, allowUnfree) instead of instantiating its own.

## `specialArgs` vs `_module.args`

Two ways to pass extra context to modules. They produce identical results downstream — pick by where the value comes from.

### `specialArgs` — outside the module system

Set at `nixosSystem` call time. Use this for values that come from the *flake input layer*: `inputs`, `mylib` (your custom helpers), `myvars` (centralized vars), `theme`, `currentSystemName`.

```nix
nixpkgs.lib.nixosSystem {
  specialArgs = { inherit inputs mylib myvars; };
  modules = [ ... ];
};
```

### `_module.args` — inside the module system

Set inside a module. Use this when the value depends on `config`/`pkgs`/`lib`. Modules below it can read the arg.

```nix
# Inside any module:
{
  config._module.args = {
    currentSystemName = "phoenix";    # static
    isWSL = false;
  };
}
```

### Rule of thumb

- Static values from the flake → `specialArgs`.
- Computed values from inside a module → `_module.args`.
- If unsure, prefer `specialArgs` — it's evaluated earlier and produces clearer errors.

## Inputs Discipline

### Pin to a release channel by default

```nix
nixpkgs.url = "github:nixos/nixpkgs/nixos-25.11";   # release branch
home-manager.url = "github:nix-community/home-manager/release-25.11";   # matching release
```

Pin to `nixos-unstable` only if you've decided you want unstable globally. Pin to a specific commit hash only when reproducing a bug or working around a known regression — and add a comment explaining why.

### Always set `follows`

```nix
home-manager.inputs.nixpkgs.follows = "nixpkgs";
sops-nix.inputs.nixpkgs.follows = "nixpkgs";
disko.inputs.nixpkgs.follows = "nixpkgs";
nix-darwin.inputs.nixpkgs.follows = "nixpkgs-darwin";   # if you have a separate darwin pin
```

Why: each `inputs.X.nixpkgs` that doesn't follow yours pulls a *separate* nixpkgs, doubles eval time, and risks version skew. The exception is rare — document inline if so:

```nix
neovim-nightly-overlay = {
  url = "github:nix-community/neovim-nightly-overlay";
  # Note: NOT following nixpkgs — upstream tests against its own pinned version.
};
```

### Multiple nixpkgs channels

If you want stable + unstable simultaneously, pick **one** of these patterns:

#### Pattern 1 — overlay (Misterio77 / mitchellh style)

```nix
inputs.nixpkgs-unstable.url = "github:nixos/nixpkgs/nixos-unstable";

# In flake.nix outputs:
overlays = [
  (final: prev: {
    unstable = import inputs.nixpkgs-unstable {
      system = prev.system;
      config.allowUnfree = true;
    };
  })
];
```

Then in modules: `pkgs.unstable.firefox`.

#### Pattern 2 — multiple `pkgs-*` via specialArgs (ryan4yin style)

```nix
genSpecialArgs = system: inputs // {
  pkgs-stable = import inputs.nixpkgs-stable { inherit system; config.allowUnfree = true; };
  pkgs-master = import inputs.nixpkgs-master { inherit system; config.allowUnfree = true; };
};
```

Then in modules: `{ pkgs-stable, ... }: { home.packages = [ pkgs-stable.firefox ]; }`.

**Don't mix the two.** Pick one and stay consistent across the repo.

## The `outputs/` Directory Pattern

When you have ≥5 hosts or multi-platform, the inline-flake style stops scaling. Move to the directory pattern:

```
outputs/
├── default.nix              # composes everything; builds genSpecialArgs
├── x86_64-linux/
│   ├── default.nix          # aggregates this system's outputs
│   └── src/
│       ├── phoenix.nix      # one file per host
│       └── server.nix
└── aarch64-darwin/
    ├── default.nix
    └── src/
        └── jade.nix
```

### `outputs/default.nix` skeleton

```nix
{ self, nixpkgs, ... }@inputs:
let
  inherit (inputs.nixpkgs) lib;
  mylib = import ../lib { inherit lib; };
  myvars = import ../vars { inherit lib; };

  genSpecialArgs = system: inputs // {
    inherit mylib myvars;
    pkgs-stable = import inputs.nixpkgs-stable { inherit system; config.allowUnfree = true; };
  };

  args = { inherit inputs lib mylib myvars genSpecialArgs; };

  nixosSystems = {
    x86_64-linux = import ./x86_64-linux (args // { system = "x86_64-linux"; });
    aarch64-linux = import ./aarch64-linux (args // { system = "aarch64-linux"; });
  };
  darwinSystems = {
    aarch64-darwin = import ./aarch64-darwin (args // { system = "aarch64-darwin"; });
  };

  allSystemNames = builtins.attrNames (nixosSystems // darwinSystems);
  forAllSystems = f: lib.genAttrs allSystemNames f;
in
{
  nixosConfigurations = lib.attrsets.mergeAttrsList (
    map (it: it.nixosConfigurations or {}) (builtins.attrValues nixosSystems)
  );

  darwinConfigurations = lib.attrsets.mergeAttrsList (
    map (it: it.darwinConfigurations or {}) (builtins.attrValues darwinSystems)
  );

  formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
}
```

### `outputs/x86_64-linux/default.nix` (haumea variant)

If you want auto-discovery of files under `src/`:

```nix
{ lib, inputs, ... }@args:
let
  inherit (inputs) haumea;
  data = haumea.lib.load { src = ./src; inputs = args; };
  values = builtins.attrValues data;
in
{
  nixosConfigurations = lib.attrsets.mergeAttrsList (
    map (it: it.nixosConfigurations or {}) values
  );
}
```

Without haumea, you can roll your own with `mylib.scanPaths`:

```nix
{ lib, inputs, mylib, ... }@args:
let
  hostFiles = mylib.scanPaths ./src;
  hostOutputs = map (f: import f args) hostFiles;
in
{
  nixosConfigurations = lib.attrsets.mergeAttrsList (
    map (it: it.nixosConfigurations or {}) hostOutputs
  );
}
```

### `outputs/x86_64-linux/src/phoenix.nix`

```nix
{ inputs, lib, mylib, system, genSpecialArgs, ... }@args:
let
  name = "phoenix";
  modules = {
    nixos-modules = (map mylib.relativeToRoot [
      "modules/nixos/desktop.nix"
      "hosts/${name}"
      "secrets/nixos.nix"
    ]) ++ [
      { modules.desktop.gnome.enable = true; }
    ];
    home-modules = map mylib.relativeToRoot [
      "home/hosts/linux/${name}.nix"
    ];
  };
in
{
  nixosConfigurations.${name} = mylib.nixosSystem (modules // args);
}
```

## When to Graduate Between Shapes

| Hosts | Platforms | Shape |
|---|---|---|
| 1 | NixOS only | Inline flake, no `mkSystem` needed (just `nixpkgs.lib.nixosSystem` directly). |
| 2-3 | NixOS + nix-darwin | Inline flake + `lib/mksystem.nix`. |
| 4-5 | Mixed | Inline flake + `mkSystem` is still readable. |
| ≥6 | Mixed | Move to `outputs/` directory. |
| ≥10 | Mixed + remote deploy | Add `colmena` or `deploy-rs`. Per-host file under `outputs/<system>/src/`. |

Don't graduate prematurely. A 30-line `flake.nix` is easier to reason about than a 5-line `flake.nix` plus 200 lines spread across `outputs/`.

## Checklist

- [ ] `flake.nix` has zero secrets.
- [ ] Every input with its own `nixpkgs` has `follows = "nixpkgs"`.
- [ ] One `mkSystem` helper, used by every host.
- [ ] `specialArgs` includes `inputs` plus any host-level metadata.
- [ ] `home-manager.useGlobalPkgs = true` (don't instantiate a second pkgs).
- [ ] Hardware files live under `hosts/<name>/` and are version-controlled.
- [ ] No `import nixpkgs { ... }` inside modules — use `pkgs` from the module args.
