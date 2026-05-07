# Home Manager

Patterns for integrating home-manager into a Nix flake. Two modes (integrated vs standalone), dotfile strategies (Nix-native, `readFile`, out-of-store symlinks, binary wrapping), and cross-platform tricks.

## Two Integration Modes

### Mode 1 — Integrated as NixOS / nix-darwin module (recommended)

Home-manager runs at system activation. The user's HM config lives inside `mkSystem`'s module list:

```nix
# Inside mkSystem, after other modules:
modules = [
  ...
  inputs.home-manager.nixosModules.home-manager
  {
    home-manager.useGlobalPkgs = true;
    home-manager.useUserPackages = true;
    home-manager.backupFileExtension = "hm-backup";
    home-manager.extraSpecialArgs = { inherit inputs isWSL; };
    home-manager.users.${user} = import ../users/${user}/home-manager.nix;
  }
];
```

For nix-darwin, swap `nixosModules.home-manager` for `darwinModules.home-manager`.

**Pros:**

- Single rebuild command (`nixos-rebuild switch`) updates both system and user.
- HM uses the system's `pkgs` (overlays, allowUnfree apply).
- `nix store gc` doesn't garbage-collect HM closures unexpectedly.

**Cons:**

- HM can't be applied without root (you can't run it on a non-NixOS system you don't admin).

### Mode 2 — Standalone `homeConfigurations`

Home-manager runs as a per-user CLI tool (`home-manager switch`). Use this for non-NixOS Linux (Ubuntu, Fedora, WSL where you don't manage the kernel) or remote machines you SSH into without root.

```nix
# In flake.nix outputs:
homeConfigurations."pavlo@phoenix" = inputs.home-manager.lib.homeManagerConfiguration {
  pkgs = nixpkgs.legacyPackages.x86_64-linux;
  extraSpecialArgs = { inherit inputs; };
  modules = [ ./users/pavlo/home-manager.nix ];
};
```

Then deploy with:

```bash
nix run home-manager/release-25.11 -- switch --flake .#pavlo@phoenix
```

**Pros:**

- Works on any Linux distro.
- User-only — no root needed.

**Cons:**

- HM has its own `pkgs` instantiation unless you wire overlays manually.
- Two activation paths to manage.

### Choosing

| Scenario | Mode |
|---|---|
| You own the NixOS box | Integrated |
| You own the nix-darwin Mac | Integrated |
| Ubuntu work laptop, no root | Standalone |
| Remote server (you have SSH but not root over time) | Standalone |
| WSL (you control the distro) | Integrated |

You can have both for the same user: integrated for `phoenix`, standalone for an Ubuntu work laptop.

## `useGlobalPkgs` and `useUserPackages`

These two settings appear together. They mean:

- **`useGlobalPkgs = true`**: HM uses the parent system's `nixpkgs` instance, with the parent's overlays and config (`allowUnfree`, etc.). Without this, HM instantiates its own `nixpkgs` — which is wasteful and can cause "two firefoxes" issues.
- **`useUserPackages = true`**: HM-managed packages land in `/etc/profiles/per-user/<user>` instead of the user's profile. This makes them visible to root operations and reduces user-profile churn.

Always set both `true` when using integrated mode.

## Cross-Platform User Module

Single `users/<user>/home-manager.nix` that works on NixOS, nix-darwin, and WSL:

```nix
{ config, lib, pkgs, isWSL ? false, ... }:

let
  isDarwin = pkgs.stdenv.isDarwin;
  isLinux = pkgs.stdenv.isLinux;
  isLinuxDesktop = isLinux && !isWSL;
in
{
  imports = [
    ../../modules/home/shells/fish.nix
    ../../modules/home/editors/neovim.nix
    ../../modules/home/git.nix
  ]
  ++ lib.optionals isLinuxDesktop [
    ../../modules/home/desktop/gnome.nix
  ]
  ++ lib.optionals isDarwin [
    ../../modules/home/darwin/aerospace.nix
  ];

  home.username = "pavlo";
  home.homeDirectory = if isDarwin then "/Users/pavlo" else "/home/pavlo";
  home.stateVersion = "25.11";
  programs.home-manager.enable = true;

  home.packages = with pkgs; [
    bat eza fd fzf gh htop jq ripgrep starship
  ]
  ++ lib.optionals isLinuxDesktop [
    firefox chromium
  ]
  ++ lib.optionals isDarwin [
    raycast
  ];

  # Cross-platform shell aliases:
  home.shellAliases = {
    ll = "eza -la";
    cat = "bat";
  } // lib.optionalAttrs isLinux {
    pbcopy = "xclip -selection clipboard";
    pbpaste = "xclip -selection clipboard -o";
  };
}
```

The three-tier split (`always`, `Linux desktop only`, `Darwin only`) handles every common case. Add `isWSL` for the rare WSL-specific exclusion.

## Dotfile Strategies

How to get config files (`.config/foo/foo.toml`) onto the user's filesystem. Four strategies, in increasing order of "Nix-ness":

### Strategy 1 — Use HM's typed program modules (best default)

For programs HM supports natively, use the typed module. It validates options, generates the config, and handles the file placement.

```nix
programs.git = {
  enable = true;
  userName = "Pavlo";
  userEmail = "pavlo@example.com";
  signing.key = "0xABCDEF1234";
  extraConfig = {
    init.defaultBranch = "main";
    pull.rebase = true;
    diff.colorMoved = "default";
  };
};

programs.fish = {
  enable = true;
  shellAbbrs = {
    ga = "git add";
    gc = "git commit";
  };
};
```

Trade-off: the Nix attrset shape doesn't always match upstream's docs 1:1. You may need `extraConfig` for advanced settings.

### Strategy 2 — `home.file` / `xdg.configFile` with `text` or `source`

For programs HM doesn't support natively, or where you have a hand-tuned config you want to keep as-is:

```nix
home.file = {
  ".gdbinit".source = ./dotfiles/gdbinit;
  ".inputrc".text = ''
    set editing-mode vi
    set show-mode-in-prompt on
  '';
};

xdg.configFile = {
  "i3/config".text = builtins.readFile ./dotfiles/i3-config;
  "rofi/config.rasi".source = ./dotfiles/rofi-config.rasi;
};
```

The difference between `.source = ./path` and `.text = builtins.readFile ./path`:

- `.source` creates a **symlink** in `~/.config/foo` pointing into the Nix store.
- `.text` materializes a **regular file** with the same content.

Use `.source` when symlinks are fine. Use `.text` when the program refuses to follow symlinks (some Electron apps, some sandboxed tools) or when you want to template the content with `${var}` interpolation.

### Strategy 3 — Out-of-store symlink for live editing

If you want to edit a config file and have it apply *without rebuilding*:

```nix
xdg.configFile."hypr/hyprland.conf".source =
  config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/nix-config/dotfiles/hyprland.conf";
```

This creates a symlink directly to your repo (not the Nix store). Edit the file, save, and the program sees the change immediately. Rebuilds only required when adding/removing files.

Caveat: the symlink target must exist when home-manager activates. If you point at a path that doesn't exist yet, activation succeeds but the file is broken.

### Strategy 4 — Binary wrapping with `symlinkJoin` + `wrapProgram`

For programs where you want the config baked into the binary itself (so `nix run .#foo` always uses the right config). Inspired by **sioodmy/dotfiles**.

```nix
{ pkgs, theme, ... }:

let
  config = pkgs.writeText "foot.ini" (pkgs.lib.generators.toINI {} {
    main = {
      font = "JetBrains Mono:size=12";
      dpi-aware = "yes";
    };
    colors = with theme; {
      alpha = "1.0";
      background = background;
      foreground = text;
      regular0 = regular.background;
      regular1 = regular.red;
      # ... etc
    };
  });
in
pkgs.symlinkJoin {
  name = "foot-wrapped";
  paths = [ pkgs.foot ];
  buildInputs = [ pkgs.makeWrapper ];
  postBuild = ''
    wrapProgram $out/bin/foot --add-flags "--config=${config}"
  '';
}
```

This produces a derivation `foot-wrapped` whose `bin/foot` always launches with the wrapped config. Useful when:

- The program supports `--config <path>` (most do).
- You want zero `~/.config/foo/` files (everything is in `/nix/store`).
- You want `nix shell .#foot` to give a fully-themed binary.

Trade-off: HM's program module won't know about your wrapped binary, so service files etc. need to reference the wrapped path explicitly.

## Sourcing Non-Flake Inputs

For shell plugins and other scripts in non-flake repos, pin them as `flake = false` inputs and source them in HM:

```nix
# flake.nix
inputs.theme-bobthefish = {
  url = "github:oh-my-fish/theme-bobthefish/e3b4d4eafc23516e35f162686f08a42edf844e40";
  flake = false;
};
inputs.fish-fzf = {
  url = "github:jethrokuan/fzf/24f4739fc1dffafcc0da3ccfbbd14d9c7d31827a";
  flake = false;
};

# In HM module:
programs.fish = {
  enable = true;
  plugins = map (n: { name = n; src = inputs.${n}; }) [
    "theme-bobthefish"
    "fish-fzf"
  ];
};
```

The `inputs.<name>` evaluates to a Nix store path containing the repo contents.

## Secrets in Home-Manager

`sops-nix` and `agenix` both have home-manager modules. Use them when secrets are user-scoped (SSH keys, GPG keys, API tokens). For per-host secrets that root services need (database passwords, certificates), use the NixOS module instead.

```nix
# users/pavlo/home-manager.nix
{ config, inputs, ... }:
{
  imports = [ inputs.sops-nix.homeManagerModules.sops ];

  sops.age.keyFile = "${config.home.homeDirectory}/.config/sops/age/keys.txt";
  sops.defaultSopsFile = ../../secrets/pavlo/secrets.yaml;
  sops.secrets."github-token" = {};
  sops.secrets."ssh-key" = {
    path = "${config.home.homeDirectory}/.ssh/id_ed25519";
    mode = "0600";
  };
}
```

See `secrets.md` for the full sops-nix workflow.

## Sessions Variables and Path

```nix
home.sessionVariables = {
  EDITOR = "nvim";
  PAGER = "less -FirSwX";
  LANG = "en_US.UTF-8";

  # 1Password CLI references — resolved at use time, not eval time
  GITHUB_TOKEN = "op://Private/github-pat/credential";
};

home.sessionPath = [
  "$HOME/.local/bin"
  "$HOME/.cargo/bin"
];
```

`sessionVariables` are exported in the user's shell init. `sessionPath` prepends to `PATH`. For cross-shell consistency, prefer these over per-shell `programs.<shell>.shellAliases`.

## Common Pitfalls

### Pitfall 1 — `programs.X.enable = true` clobbers existing config

If you previously had a hand-managed `~/.config/foo/foo.conf`, enabling `programs.foo` may overwrite it (or HM refuses to activate if `.source` conflicts with an existing file). Use `home-manager.backupFileExtension` (e.g. `"hm-backup"`) so HM moves the existing file aside.

### Pitfall 2 — `home.stateVersion` mismatch

Set `home.stateVersion` to the version when you first installed HM, **never bump it**. It's an opt-in switch for breaking changes. Check the [HM release notes](https://nix-community.github.io/home-manager/release-notes.xhtml) before changing.

### Pitfall 3 — `useGlobalPkgs = false` causing version skew

Without `useGlobalPkgs`, HM uses the `pkgs` from `home-manager.lib.homeManagerConfiguration { pkgs = ... }`. This is fine for standalone but in integrated mode, you want the system's `pkgs`. Always set `true` for integrated.

### Pitfall 4 — Forgetting `programs.home-manager.enable = true` in standalone mode

Without it, you can't update HM itself via `home-manager switch`. Required only in standalone mode; in integrated mode, the system module handles HM's own packages.

### Pitfall 5 — Hardcoded `/home/pavlo` paths

Use `config.home.homeDirectory` instead. On nix-darwin it's `/Users/pavlo`, on Linux it's `/home/pavlo`. Hardcoding breaks cross-platform configs.

```nix
# BAD
xdg.configFile."foo".source = "/home/pavlo/dotfiles/foo";

# GOOD
xdg.configFile."foo".source =
  config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/dotfiles/foo";
```

### Pitfall 6 — Not setting `extraSpecialArgs`

Without `home-manager.extraSpecialArgs = { inherit inputs; }`, the HM module can't reach `inputs`. Then references like `inputs.theme-bobthefish` fail. Always pass `inputs` (and any other context) through `extraSpecialArgs`.

## Checklist

- [ ] Decided integrated vs standalone (default: integrated when you own the system).
- [ ] `home-manager.useGlobalPkgs = true; home-manager.useUserPackages = true;`.
- [ ] `home-manager.extraSpecialArgs = { inherit inputs; }` (and theme, isWSL, etc. if used).
- [ ] User module is cross-platform (`isDarwin`, `isLinux`, `isWSL` checks).
- [ ] Dotfile strategy chosen consistently (HM module > `xdg.configFile.text` > out-of-store symlink > wrapper).
- [ ] No hardcoded `/home/<user>` paths.
- [ ] `home.stateVersion` set and never bumped without reading release notes.
