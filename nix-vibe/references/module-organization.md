# Module Organization

How to lay out `modules/`, `hosts/`, and `users/` so the flake stays readable as it grows.

## Directory Layout

This is the canonical shape, derived from ryan4yin + Misterio77 + mitchellh:

```
nix-config/
├── flake.nix
├── lib/
│   ├── default.nix              # mylib — your helpers
│   └── mksystem.nix             # the system constructor
├── vars/
│   ├── default.nix              # username, email, password hash, SSH keys
│   └── networking.nix           # gateway, DNS, hosts table
├── hosts/
│   ├── phoenix/
│   │   ├── default.nix          # imports + per-host overrides
│   │   ├── hardware-configuration.nix
│   │   └── disko.nix            # if using disko
│   └── jade/
│       └── default.nix
├── users/
│   └── pavlo/
│       ├── nixos.nix            # NixOS user module
│       ├── darwin.nix           # nix-darwin user module
│       ├── home-manager.nix     # cross-platform HM entry
│       └── dotfiles/            # raw dotfile sources (i3, kitty, etc.)
├── modules/
│   ├── common/                  # shared between NixOS + nix-darwin
│   │   ├── default.nix
│   │   └── nix-settings.nix
│   ├── nixos/
│   │   ├── default.nix
│   │   ├── desktop/
│   │   │   ├── default.nix
│   │   │   ├── gnome.nix
│   │   │   └── gaming.nix
│   │   ├── networking.nix
│   │   └── virtualization.nix
│   ├── darwin/
│   │   ├── default.nix
│   │   └── homebrew.nix
│   └── home/
│       ├── default.nix
│       ├── shells/
│       │   ├── fish.nix
│       │   └── zsh.nix
│       └── editors/
│           └── neovim.nix
├── overlays/
│   └── default.nix              # additions / modifications / unstable-packages
├── pkgs/
│   ├── default.nix              # custom packages map
│   └── my-tool/
│       └── default.nix
├── secrets/                     # sops-nix encrypted files (per-host subdirs)
│   ├── phoenix/
│   │   └── secrets.yaml
│   └── shared/
│       └── shared.yaml
└── treefmt.nix
```

Adapt to taste, but maintain the **separation of concerns**:

- `hosts/<name>/` is **machine-specific** (hardware, mount points, network interface name).
- `users/<name>/` is **user-specific** (dotfiles, shell config, signing keys).
- `modules/<scope>/` is **feature-specific** and reusable across hosts/users.
- `vars/` is **values** (hostnames, IPs, fingerprints).
- `lib/` is **functions** (helpers).

## Options-Driven Modules

Each module exports an `options.modules.<area>.<feature>.enable` flag. Per-host configs become tiny.

### Module pattern

```nix
# modules/nixos/desktop/gnome.nix
{ config, lib, pkgs, ... }:

let
  cfg = config.modules.desktop.gnome;
in
{
  options.modules.desktop.gnome = {
    enable = lib.mkEnableOption "GNOME desktop environment";

    extensions = lib.mkOption {
      type = lib.types.listOf lib.types.package;
      default = with pkgs.gnomeExtensions; [
        appindicator
        blur-my-shell
        dash-to-dock
      ];
      description = "GNOME shell extensions to install.";
    };
  };

  config = lib.mkIf cfg.enable {
    services.xserver.enable = true;
    services.xserver.displayManager.gdm.enable = true;
    services.xserver.desktopManager.gnome.enable = true;

    environment.systemPackages = cfg.extensions;
    services.gnome.gnome-keyring.enable = true;
  };
}
```

### Per-host usage

```nix
# hosts/phoenix/default.nix
{ ... }:
{
  imports = [
    ./hardware-configuration.nix
    ./disko.nix
  ];

  modules.desktop.gnome.enable = true;
  modules.desktop.gaming.enable = true;
  modules.networking.tailscale.enable = true;

  networking.hostName = "phoenix";
  system.stateVersion = "25.11";
}
```

The host file should be **mostly toggles + machine-specific facts**. Anything that could apply to a different host belongs under `modules/`.

## Auto-loading Modules with `mylib.scanPaths`

Manually maintaining `imports = [ ./desktop/gnome.nix ./desktop/gaming.nix ./networking.nix ];` becomes tedious. Auto-discover instead:

```nix
# lib/default.nix
{ lib, ... }:
{
  # Build paths relative to the flake root from any subdirectory.
  relativeToRoot = lib.path.append ../.;

  # Returns all .nix files (excluding default.nix) and all directories under `path`.
  scanPaths = path:
    builtins.map (f: path + "/${f}") (
      builtins.attrNames (
        lib.attrsets.filterAttrs
          (p: type:
            type == "directory"
            || (p != "default.nix" && lib.strings.hasSuffix ".nix" p))
          (builtins.readDir path)
      )
    );
}
```

Then in any `default.nix`:

```nix
# modules/nixos/desktop/default.nix
{ mylib, ... }:
{
  imports = mylib.scanPaths ./.;
}
```

Drop a new `.nix` file under `modules/nixos/desktop/` and it's loaded automatically. Pair with options-driven enable flags so adding a file doesn't change behavior until a host opts in.

## Common Module: `common`, `nixos`, `darwin`, `home`

If you have `phoenix` (NixOS) and `jade` (nix-darwin), some settings apply to both — `nix.settings`, font packages, shell aliases. Put those under `modules/common/`.

```nix
# modules/common/nix-settings.nix
{ lib, pkgs, ... }:
{
  nix.settings = {
    experimental-features = [ "nix-command" "flakes" ];
    auto-optimise-store = true;
    trusted-users = [ "@wheel" ];
  };

  nix.gc = {
    automatic = true;
    options = "--delete-older-than 7d";
  };

  nixpkgs.config.allowUnfree = true;
}
```

Then in both NixOS host and nix-darwin host:

```nix
imports = [ ../../modules/common ];
```

## User Modules: Three Files Per Username

```
users/pavlo/
├── nixos.nix          # users.users.pavlo, system-level user toggles
├── darwin.nix         # users.users.pavlo for nix-darwin, homebrew packages
├── home-manager.nix   # cross-platform home-manager module
└── dotfiles/          # raw dotfile sources (optional)
```

### `users/pavlo/nixos.nix`

```nix
{ pkgs, ... }:
{
  users.users.pavlo = {
    isNormalUser = true;
    home = "/home/pavlo";
    extraGroups = [ "wheel" "networkmanager" "docker" "video" "audio" ];
    shell = pkgs.fish;
    openssh.authorizedKeys.keys = [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... pavlo@phoenix"
    ];
  };

  programs.fish.enable = true;
  programs.nix-ld.enable = true;
}
```

### `users/pavlo/home-manager.nix`

This is the user's actual config. Keep it cross-platform with `pkgs.stdenv.isDarwin` / `isLinux` checks:

```nix
{ config, lib, pkgs, isWSL ? false, ... }:

let
  isDarwin = pkgs.stdenv.isDarwin;
  isLinux = pkgs.stdenv.isLinux;
in
{
  imports = [
    ../../modules/home/shells/fish.nix
    ../../modules/home/editors/neovim.nix
  ] ++ lib.optionals (isLinux && !isWSL) [
    ../../modules/home/desktop.nix
  ];

  home.username = "pavlo";
  home.homeDirectory = if isDarwin then "/Users/pavlo" else "/home/pavlo";
  home.stateVersion = "25.11";

  home.packages = with pkgs; [
    bat eza fd fzf jq ripgrep starship
  ] ++ lib.optionals (isLinux && !isWSL) [
    firefox
  ];

  programs.git = {
    enable = true;
    userName = "Pavlo";
    userEmail = "pavlo@example.com";
    extraConfig = {
      init.defaultBranch = "main";
      pull.rebase = true;
    };
  };
}
```

## Centralizing Vars (`vars/`)

Single source of truth for username, email, hashed password, SSH keys, and network topology. Inspired by **ryan4yin/nix-config**.

```nix
# vars/default.nix
{ lib }:
{
  username = "pavlo";
  fullname = "Pavlo";
  email = "pavlo@example.com";

  # mkpasswd -m yescrypt --rounds=11
  initialHashedPassword = "$y$jFT$...";

  authorizedKeys = [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... pavlo@phoenix"
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... pavlo@jade"
  ];

  networking = import ./networking.nix { inherit lib; };
}
```

```nix
# vars/networking.nix
{ lib }:
rec {
  gateway = "192.168.1.1";
  nameservers = [ "1.1.1.1" "8.8.8.8" ];
  prefixLength = 24;

  hosts = {
    phoenix = { iface = "wlp1s0"; ipv4 = "192.168.1.10"; };
    jade    = { iface = "en0";    ipv4 = "192.168.1.11"; };
  };

  # Auto-derive networking.interfaces blocks
  hostsInterface = lib.mapAttrs (_: val: {
    interfaces."${val.iface}" = {
      useDHCP = false;
      ipv4.addresses = [{ inherit prefixLength; address = val.ipv4; }];
    };
  }) hosts;
}
```

Then in `mkSystem` or `outputs/default.nix`:

```nix
specialArgs = { inherit inputs mylib myvars; };
```

In any module:

```nix
{ myvars, ... }:
{
  users.users.${myvars.username} = {
    isNormalUser = true;
    initialHashedPassword = myvars.initialHashedPassword;
    openssh.authorizedKeys.keys = myvars.authorizedKeys;
  };
}
```

## Module Argument Conventions

A module is a function. Standardize the argument list:

```nix
{ config, lib, pkgs, inputs, mylib, myvars, ... }:
```

In order: NixOS-provided (`config`, `lib`, `pkgs`), then your `specialArgs` (`inputs`, `mylib`, `myvars`), then any per-module additions (`isWSL`, `theme`, etc.).

Always end with `, ...` to allow extra args without breaking.

## Avoid: `with pkgs;` for Long Lists

```nix
# BAD: scopes everything; slow eval; shadowing risk
environment.systemPackages = with pkgs; [
  bat eza fd fzf git htop jq lazygit ncdu ripgrep starship tree zoxide
];

# GOOD: explicit and lint-friendly
environment.systemPackages = builtins.attrValues {
  inherit (pkgs)
    bat eza fd fzf git htop jq lazygit ncdu ripgrep starship tree zoxide;
};

# ALSO GOOD: for short lists, `with pkgs;` is fine
environment.systemPackages = with pkgs; [ git htop ];
```

The `inherit (pkgs)` form has no `with` overhead and reads as "pull these names from pkgs."

## Specialisations (Boot-Time Variants)

NixOS supports **specialisations** — alternative configurations selectable from the systemd-boot menu. Useful for "same hardware, different desktop" or "same hardware, debug kernel."

```nix
# modules/nixos/specialisation/i3.nix
{ pkgs, ... }:
{
  specialisation.i3.configuration = {
    services.xserver.enable = true;
    services.xserver.windowManager.i3.enable = true;
    services.xserver.displayManager.lightdm.enable = true;
  };
}
```

```nix
# modules/nixos/specialisation/plasma.nix
{ pkgs, ... }:
{
  specialisation.plasma.configuration = {
    services.xserver.enable = true;
    services.displayManager.sddm.enable = true;
    services.desktopManager.plasma6.enable = true;
  };
}
```

Imported in the parent module/host. The boot menu shows entries like `default`, `i3`, `plasma`. Specialisations don't rebuild from scratch — they share most of the closure.

Caveat: `lib.mkForce` overrides settings from the parent in a specialisation if needed.

## Checklist

- [ ] Modules go under `modules/<scope>/<feature>.nix`, where `<scope>` ∈ `{common, nixos, darwin, home}`.
- [ ] Every feature module has `options.modules.<area>.<feature>.enable` and gates with `lib.mkIf cfg.enable`.
- [ ] `default.nix` files use `mylib.scanPaths ./.` for auto-import.
- [ ] Host files are <50 lines, mostly toggles and hardware imports.
- [ ] User config has three files (`nixos.nix`, `darwin.nix`, `home-manager.nix`) per user.
- [ ] `vars/default.nix` is the single source for username, email, password hashes, network topology.
- [ ] No `with pkgs;` over long lists — use `inherit (pkgs) a b c;`.
