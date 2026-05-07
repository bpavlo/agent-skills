# Templates

Copy-pasteable starting points for new flakes, hosts, modules, and secrets.

## Template 1 — Minimal Single-Host Flake

For a single NixOS or nix-darwin host. <80 lines total.

```
nix-config/
├── flake.nix
├── configuration.nix
├── hardware-configuration.nix
└── home.nix
```

### `flake.nix`

```nix
{
  description = "Personal nix configuration";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.11";

    home-manager.url = "github:nix-community/home-manager/release-25.11";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, home-manager, ... }@inputs: {
    nixosConfigurations.phoenix = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      specialArgs = { inherit inputs; };
      modules = [
        ./configuration.nix
        home-manager.nixosModules.home-manager
        {
          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;
          home-manager.extraSpecialArgs = { inherit inputs; };
          home-manager.users.pavlo = import ./home.nix;
        }
      ];
    };
  };
}
```

### `configuration.nix`

```nix
{ inputs, pkgs, ... }:
{
  imports = [ ./hardware-configuration.nix ];

  nixpkgs.config.allowUnfree = true;
  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  networking.hostName = "phoenix";
  networking.networkmanager.enable = true;
  time.timeZone = "Europe/Kyiv";
  i18n.defaultLocale = "en_US.UTF-8";

  users.users.pavlo = {
    isNormalUser = true;
    extraGroups = [ "wheel" "networkmanager" ];
    initialPassword = "changeme";
  };

  services.openssh.enable = true;
  services.openssh.settings.PermitRootLogin = "no";

  environment.systemPackages = with pkgs; [
    git vim curl
  ];

  system.stateVersion = "25.11";
}
```

### `home.nix`

```nix
{ inputs, pkgs, ... }:
{
  home.username = "pavlo";
  home.homeDirectory = "/home/pavlo";
  home.stateVersion = "25.11";
  programs.home-manager.enable = true;

  home.packages = with pkgs; [
    bat eza fd fzf htop jq ripgrep starship
  ];

  programs.git = {
    enable = true;
    userName = "Pavlo";
    userEmail = "pavlo@example.com";
  };

  programs.fish.enable = true;
  programs.starship.enable = true;
}
```

## Template 2 — Multi-Host with `mkSystem`

For 2-5 hosts mixing NixOS and nix-darwin. The mitchellh-style baseline.

```
nix-config/
├── flake.nix
├── lib/
│   └── mksystem.nix
├── hosts/
│   ├── phoenix/
│   │   ├── default.nix
│   │   └── hardware-configuration.nix
│   └── jade/
│       └── default.nix
├── users/
│   └── pavlo/
│       ├── nixos.nix
│       ├── darwin.nix
│       └── home-manager.nix
└── modules/
    └── common.nix
```

### `flake.nix`

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

  outputs = { self, nixpkgs, ... }@inputs: let
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

### `lib/mksystem.nix`

```nix
{ nixpkgs, overlays, inputs }:

name:
{ system, user, darwin ? false, wsl ? false }:

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
      ../modules/common.nix
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

### `hosts/phoenix/default.nix`

```nix
{ ... }:
{
  imports = [ ./hardware-configuration.nix ];

  networking.hostName = "phoenix";
  networking.networkmanager.enable = true;
  time.timeZone = "Europe/Kyiv";
  i18n.defaultLocale = "en_US.UTF-8";

  services.openssh.enable = true;
  services.tailscale.enable = true;

  system.stateVersion = "25.11";
}
```

### `hosts/jade/default.nix`

```nix
{ pkgs, ... }:
{
  homebrew = {
    enable = true;
    casks = [ "raycast" "1password" "google-chrome" ];
    brews = [ "gnupg" ];
  };

  system.stateVersion = 5;
  system.primaryUser = "pavlo";

  programs.fish.enable = true;
  environment.shells = [ pkgs.fish ];
}
```

### `users/pavlo/nixos.nix`

```nix
{ pkgs, ... }:
{
  users.users.pavlo = {
    isNormalUser = true;
    home = "/home/pavlo";
    extraGroups = [ "wheel" "networkmanager" "docker" "video" ];
    shell = pkgs.fish;
    openssh.authorizedKeys.keys = [
      # "ssh-ed25519 AAAAC3... pavlo@admin"
    ];
  };
  programs.fish.enable = true;
}
```

### `users/pavlo/darwin.nix`

```nix
{ pkgs, ... }:
{
  users.users.pavlo = {
    home = "/Users/pavlo";
    shell = pkgs.fish;
  };
}
```

### `users/pavlo/home-manager.nix`

```nix
{ config, lib, pkgs, isWSL ? false, ... }:

let
  isDarwin = pkgs.stdenv.isDarwin;
  isLinux = pkgs.stdenv.isLinux;
in
{
  home.username = "pavlo";
  home.homeDirectory = if isDarwin then "/Users/pavlo" else "/home/pavlo";
  home.stateVersion = "25.11";
  programs.home-manager.enable = true;

  home.packages = with pkgs; [
    bat eza fd fzf gh htop jq ripgrep starship
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

  programs.fish.enable = true;
  programs.starship.enable = true;
}
```

### `modules/common.nix`

```nix
{ lib, pkgs, ... }:
{
  nix.settings = {
    experimental-features = [ "nix-command" "flakes" ];
    auto-optimise-store = true;
    trusted-users = [ "root" "@wheel" "@admin" ];
  };

  nix.gc = {
    automatic = true;
    options = "--delete-older-than 7d";
  };

  nixpkgs.config.allowUnfree = true;
}
```

## Template 3 — `.sops.yaml`

```yaml
# .sops.yaml — at repo root
keys:
  # Replace with: age-keygen -y ~/.config/sops/age/keys.txt
  - &admin_pavlo  age1youradminkeyhere...

  # Replace with: ssh-to-age < /etc/ssh/ssh_host_ed25519_key.pub on each host
  - &host_phoenix age1phoenixhostkeyhere...
  - &host_jade    age1jadehostkeyhere...

creation_rules:
  - path_regex: secrets/phoenix/[^/]+\.(yaml|json|env|ini)$
    key_groups:
      - age:
          - *admin_pavlo
          - *host_phoenix

  - path_regex: secrets/jade/[^/]+\.(yaml|json|env|ini)$
    key_groups:
      - age:
          - *admin_pavlo
          - *host_jade

  - path_regex: secrets/shared/[^/]+\.(yaml|json|env|ini)$
    key_groups:
      - age:
          - *admin_pavlo
          - *host_phoenix
          - *host_jade
```

## Template 4 — Feature Module

A reusable module with options. Drop-in starting point under `modules/<area>/<feature>.nix`.

```nix
{ config, lib, pkgs, ... }:

let
  cfg = config.modules.area.feature;
in
{
  options.modules.area.feature = {
    enable = lib.mkEnableOption "feature description";

    setting = lib.mkOption {
      type = lib.types.str;
      default = "default-value";
      description = "What this setting does.";
    };

    extraPackages = lib.mkOption {
      type = lib.types.listOf lib.types.package;
      default = [];
      description = "Additional packages to install.";
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ pkgs.example ] ++ cfg.extraPackages;

    services.example = {
      enable = true;
      setting = cfg.setting;
    };

    # Wire systemd, networking, etc.
  };
}
```

## Template 5 — `disko.nix` (Btrfs + LUKS + TPM2)

```nix
# hosts/<host>/disko.nix
{
  disko.devices = {
    disk.main = {
      device = "/dev/disk/by-id/CHANGE_ME";
      type = "disk";
      content = {
        type = "gpt";
        partitions = {
          ESP = {
            size = "1G";
            type = "EF00";
            content = {
              type = "filesystem";
              format = "vfat";
              mountpoint = "/boot";
              mountOptions = [ "umask=0077" ];
            };
          };

          luks = {
            size = "100%";
            content = {
              type = "luks";
              name = "cryptroot";
              extraOpenArgs = [ "--allow-discards" ];
              passwordFile = "/tmp/secret.key";
              settings = {
                allowDiscards = true;
                crypttabExtraOpts = [ "tpm2-device=auto" ];
              };
              content = {
                type = "btrfs";
                extraArgs = [ "-L" "nixos" "-f" ];
                subvolumes = {
                  "@root" = {
                    mountpoint = "/";
                    mountOptions = [ "compress=zstd" "noatime" "discard=async" ];
                  };
                  "@home" = {
                    mountpoint = "/home";
                    mountOptions = [ "compress=zstd" "noatime" "discard=async" ];
                  };
                  "@nix" = {
                    mountpoint = "/nix";
                    mountOptions = [ "compress=zstd" "noatime" "discard=async" ];
                  };
                  "@snapshots" = {
                    mountpoint = "/.snapshots";
                    mountOptions = [ "compress=zstd" "noatime" ];
                  };
                };
              };
            };
          };
        };
      };
    };
  };
}
```

## Template 6 — `Justfile`

```just
set shell := ["bash", "-uc"]

default:
    @just --list

# Build and switch the current host
[linux]
switch:
    sudo nixos-rebuild switch --flake .#$(hostname)

[macos]
switch:
    sudo darwin-rebuild switch --flake .#$(hostname)

# Build only (no activation)
build host=`hostname`:
    nix build .#nixosConfigurations.{{host}}.config.system.build.toplevel

# Test (activate without setting boot default)
[linux]
test host=`hostname`:
    sudo nixos-rebuild test --flake .#{{host}}

# Format Nix files
fmt:
    nix fmt

# Run all checks
check:
    nix flake check

# Update flake inputs
up:
    nix flake update --commit-lock-file

# Update one input
upp input:
    nix flake update {{input}} --commit-lock-file

# Garbage collect older than 7 days
gc:
    sudo nix-collect-garbage --delete-older-than 7d
    nix-collect-garbage --delete-older-than 7d

# Show diff between current system and result
[linux]
diff:
    nvd diff /run/current-system result
```

## Template 7 — `treefmt.nix`

```nix
# treefmt.nix
{ pkgs, ... }:
{
  projectRootFile = "flake.nix";

  programs = {
    nixfmt.enable = true;       # Nix
    prettier.enable = true;     # YAML, JSON, Markdown
    shfmt.enable = true;        # Shell
    deadnix.enable = true;      # Dead code
    statix.enable = true;       # Lint
  };

  settings.formatter = {
    nixfmt.includes = [ "*.nix" ];
    prettier = {
      includes = [ "*.yaml" "*.yml" "*.json" "*.md" ];
      excludes = [ "flake.lock" ];
    };
  };
}
```

Wire into `flake.nix`:

```nix
inputs.treefmt-nix.url = "github:numtide/treefmt-nix";
inputs.treefmt-nix.inputs.nixpkgs.follows = "nixpkgs";

# In outputs:
formatter = forAllSystems (system:
  inputs.treefmt-nix.lib.mkWrapper nixpkgs.legacyPackages.${system}
    (import ./treefmt.nix { pkgs = nixpkgs.legacyPackages.${system}; })
);
```

Then `nix fmt` runs all the formatters.

## Template 8 — `.envrc`

```bash
# .envrc — for direnv to load the devShell
use flake
```

After `direnv allow`, every shell in the repo dir gets the dev tools.

## Template 9 — `vars/default.nix` Skeleton

```nix
# vars/default.nix
{ lib }:
{
  username = "pavlo";
  fullname = "Pavlo";
  email = "pavlo@example.com";

  # mkpasswd -m yescrypt --rounds=11
  initialHashedPassword = "$y$jFT$REPLACE_ME";

  authorizedKeys = [
    # "ssh-ed25519 AAAAC3... pavlo@admin"
  ];

  networking = import ./networking.nix { inherit lib; };
}
```

```nix
# vars/networking.nix
{ lib }:
rec {
  gateway = "192.168.1.1";
  nameservers = [ "1.1.1.1" "9.9.9.9" ];
  prefixLength = 24;

  hosts = {
    phoenix = { iface = "wlp1s0"; ipv4 = "192.168.1.10"; };
    jade    = { iface = "en0";    ipv4 = "192.168.1.11"; };
  };

  hostsInterface = lib.attrsets.mapAttrs (_: val: {
    interfaces."${val.iface}" = {
      useDHCP = false;
      ipv4.addresses = [{ inherit prefixLength; address = val.ipv4; }];
    };
  }) hosts;
}
```

## Template 10 — `lib/default.nix`

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

## Quick Snippets

### Add a host

```nix
# 1. Drop hosts/<newhost>/default.nix and hardware-configuration.nix
# 2. Add to flake.nix:
nixosConfigurations.newhost = mkSystem "newhost" {
  system = "x86_64-linux";
  user = "pavlo";
};
```

### Add a feature toggle to a host

```nix
# hosts/phoenix/default.nix
modules.desktop.gnome.enable = true;
modules.desktop.gaming.enable = true;
modules.networking.tailscale.enable = true;
```

### Add a per-host secret

```bash
nix-shell -p sops --run 'sops secrets/phoenix/secrets.yaml'
```

```nix
sops.secrets.new_token = {
  owner = config.users.users.myservice.name;
  mode = "0400";
  restartUnits = [ "myservice.service" ];
};

systemd.services.myservice.serviceConfig.LoadCredential =
  "new_token:${config.sops.secrets.new_token.path}";
```

### Re-key sops files after `.sops.yaml` change

```bash
find secrets -name "*.yaml" -exec sops updatekeys -y {} \;
```

### Verify a build before deploy

```bash
nix flake check
nix build .#nixosConfigurations.phoenix.config.system.build.toplevel --dry-run
sudo nixos-rebuild test --flake .#phoenix
sudo nixos-rebuild switch --flake .#phoenix
```
