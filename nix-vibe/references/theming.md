# Theming

Patterns for centralizing colors, fonts, cursors, and wallpaper across an entire Nix config. Inspired by **sioodmy/dotfiles** but generalized for typed/maintainable configs.

## Two Approaches

### Approach 1 — Theme attrset via `specialArgs` (sioodmy)

A single `theme/default.nix` returns an attrset. Threaded through `specialArgs` to every module.

```nix
# theme/default.nix
pkgs:
{
  # Background opacity for terminals
  opacity = 1.0;

  # Primary palette
  background = "232136";
  text = "e0def4";
  accent = "c4a7e7";

  regular = {
    background = "2a273f";
    red    = "eb6f92";
    green  = "3e8fb0";
    yellow = "f6c177";
    blue   = "9ccfd8";
    purple = "c4a7e7";
    cyan   = "ea9a97";
    white  = "e0def4";
  };

  bright = {
    background = "393552";
    red    = "eb6f92";
    green  = "3e8fb0";
    yellow = "f6c177";
    blue   = "9ccfd8";
    purple = "c4a7e7";
    cyan   = "ea9a97";
    white  = "e0def4";
  };

  # base16 slots — for tools that consume base16 directly
  base00 = "232136"; base01 = "2a273f"; base02 = "393552"; base03 = "6e6a86";
  base04 = "908caa"; base05 = "e0def4"; base06 = "e0def4"; base07 = "56526e";
  base08 = "eb6f92"; base09 = "f6c177"; base0A = "ea9a97"; base0B = "3e8fb0";
  base0C = "9ccfd8"; base0D = "c4a7e7"; base0E = "f6c177"; base0F = "56526e";

  fonts = {
    mono = "JetBrains Mono";
    sans = "Inter";
  };

  cursor = {
    package = pkgs.rose-pine-cursor;
    name = "BreezeX-RoséPine";
    size = 24;
  };

  gtk = {
    package = pkgs.rose-pine-gtk-theme;
    name = "rose-pine-gtk";
  };

  wallpaper = "${pkgs.callPackages ./_sources/generated.nix {}}/wallpapers/dark.jpg";
}
```

Wire into `mkSystem`:

```nix
specialArgs = {
  inherit inputs mylib;
  theme = import ../theme pkgs;
};
```

For home-manager:

```nix
home-manager.extraSpecialArgs = {
  inherit inputs;
  theme = import ../theme pkgs;
};
```

Then any module reads it:

```nix
{ pkgs, theme, ... }:
{
  programs.alacritty.settings = {
    window.opacity = theme.opacity;
    colors = {
      primary = {
        background = "0x${theme.background}";
        foreground = "0x${theme.text}";
      };
      normal = {
        red = "0x${theme.regular.red}";
        green = "0x${theme.regular.green}";
        # ...
      };
    };
  };

  gtk = {
    enable = true;
    theme = theme.gtk;
    cursorTheme = theme.cursor;
    font.name = theme.fonts.sans;
  };
}
```

**Pros:**
- Zero plumbing — every module gets `theme` for free.
- Both base16 slots **and** named semantic colors (`accent`, `regular.red`) coexist.
- Theme is a function over `pkgs`, so it can carry packaged themes (cursor, GTK).

**Cons:**
- No type-checking — typos like `theme.regulr.red` fail at build time, not eval time.
- No documentation generation (no `nix-doc` for the theme schema).

Best for: solo configs, rice setups, fast iteration.

### Approach 2 — Typed theme module with `lib.mkOption`

Same content, but as a NixOS option tree:

```nix
# modules/theme/default.nix
{ config, lib, pkgs, ... }:
let
  cfg = config.theme;
in
{
  options.theme = {
    enable = lib.mkEnableOption "centralized theme";

    background = lib.mkOption { type = lib.types.str; default = "232136"; };
    text = lib.mkOption { type = lib.types.str; default = "e0def4"; };
    accent = lib.mkOption { type = lib.types.str; default = "c4a7e7"; };

    regular = lib.mkOption {
      type = lib.types.submodule {
        options = {
          red = lib.mkOption { type = lib.types.str; default = "eb6f92"; };
          green = lib.mkOption { type = lib.types.str; default = "3e8fb0"; };
          # ...
        };
      };
      default = {};
    };

    fonts.mono = lib.mkOption { type = lib.types.str; default = "JetBrains Mono"; };

    cursor = {
      package = lib.mkOption {
        type = lib.types.package;
        default = pkgs.rose-pine-cursor;
      };
      name = lib.mkOption { type = lib.types.str; default = "BreezeX-RoséPine"; };
    };
  };
}
```

Then in modules:

```nix
{ config, ... }:
{
  programs.alacritty.settings.colors.primary.background = "0x${config.theme.background}";
}
```

**Pros:**
- Type-checked at eval time.
- Theme schema is documented automatically.
- Multiple modules can override defaults via standard option-merge.

**Cons:**
- Verbose to define.
- Slightly more cognitive overhead (`config.theme.x` vs just `theme.x`).

Best for: shared modules, configs you publish, multi-user setups.

## Choosing

| Use case | Approach |
|---|---|
| Personal rice config, fast iteration | Approach 1 (specialArgs) |
| Multiple users, one theme | Approach 1 |
| Building a reusable theme module | Approach 2 (typed) |
| You want `nix-doc` to document your theme | Approach 2 |
| You want eval-time validation | Approach 2 |

## base16 + Named Colors

Real-world configs benefit from having **both** base16 slots and named semantic colors in the theme:

- Apps that consume base16 (`base16-fish`, `base16-tmux`, neovim base16 plugins) read `base00..base0F` directly.
- Apps with named slots (`accent`, `regular.red`) read those without translation.
- A single theme file covers both — no mapping/translation layer.

```nix
# theme/rose-pine-moon.nix — example
{
  base00 = "232136"; base01 = "2a273f"; base02 = "393552"; base03 = "6e6a86";
  base04 = "908caa"; base05 = "e0def4"; base06 = "e0def4"; base07 = "56526e";
  base08 = "eb6f92"; base09 = "f6c177"; base0A = "ea9a97"; base0B = "3e8fb0";
  base0C = "9ccfd8"; base0D = "c4a7e7"; base0E = "f6c177"; base0F = "56526e";

  # Named semantic — derived or hand-set
  accent = "c4a7e7";       # = base0D
  background = "232136";   # = base00
  text = "e0def4";         # = base05
}
```

## GTK / Adwaita Theming via base16

For GTK 4 (libadwaita), generate `gtk.css` from base16 slots:

```nix
# user/gtk/colors.nix
{ theme }:
''
  @define-color accent_color #${theme.base0D};
  @define-color destructive_color #${theme.base08};
  @define-color success_color #${theme.base0B};
  @define-color warning_color #${theme.base0E};
  @define-color error_color #${theme.base08};
  @define-color window_bg_color #${theme.base00};
  @define-color view_bg_color #${theme.base00};
  @define-color headerbar_bg_color #${theme.base01};
  @define-color sidebar_bg_color #${theme.base01};
  @define-color card_bg_color #${theme.base01};
''
```

Then in HM:

```nix
{ config, theme, ... }:
let
  css = import ./colors.nix { inherit theme; };
in
{
  xdg.configFile = {
    "gtk-3.0/gtk.css".text = css;
    "gtk-4.0/gtk.css".text = css;
  };
}
```

## Hyprland Config from a Nix Attrset

For Hyprland (and similar single-DSL configs), generate the config string from a Nix attrset that uses `theme`:

```nix
# user/hypr/configs/Hyprland.nix
theme: {
  general = {
    "col.active_border" = "rgb(${theme.accent})";
    "col.inactive_border" = "rgb(${theme.regular.background})";
    gaps_in = 5;
    gaps_out = 5;
    border_size = 2;
  };

  decoration = {
    rounding = 10;
    blur.enabled = true;
  };

  exec-once = [
    "swaybg -i ${theme.wallpaper}"
    "hypridle"
    "waybar"
  ];

  bind = [
    "SUPER, Q, killactive"
    "SUPER, Return, exec, alacritty"
    # ...
  ];
}
```

You'll need a serializer (sioodmy's `toHyprConf`) to render the attrset to Hyprland's config syntax. Or just use HM's `programs.hyprland.settings` which now supports this natively.

## Wallpaper Sourcing

Don't commit wallpapers to your dotfiles repo. Use `nvfetcher` to pin a separate repo:

```toml
# theme/nvfetcher.toml
[wallpapers]
src.git = "https://github.com/yourname/wallpapers"
fetch.github = "yourname/wallpapers"
```

Run `nvfetcher` to generate `_sources/generated.nix`. Then:

```nix
wallpaper = let
  wallpapers = (pkgs.callPackages ./_sources/generated.nix {}).wallpapers;
in "${wallpapers.src}/dark/forest.jpg";
```

The wallpaper is now a Nix store path; no runtime download.

## Stylix (Alternative: Generated Themes)

If you don't want to hand-pick a palette, **stylix** generates a base16 theme from a wallpaper:

```nix
# flake.nix
inputs.stylix.url = "github:danth/stylix";
inputs.stylix.inputs.nixpkgs.follows = "nixpkgs";

# In a NixOS host
{ inputs, ... }:
{
  imports = [ inputs.stylix.nixosModules.stylix ];

  stylix = {
    enable = true;
    image = ./wallpapers/forest.jpg;
    base16Scheme = "${pkgs.base16-schemes}/share/themes/rose-pine-moon.yaml";
    fonts = {
      monospace = {
        package = pkgs.jetbrains-mono;
        name = "JetBrains Mono";
      };
    };
  };
}
```

Stylix automatically themes GTK, Qt, Alacritty, fish, neovim, and many other programs. Trade-off: less control over edge cases.

**When to pick stylix vs hand-rolled theme:**

| Scenario | Pick |
|---|---|
| You want one wallpaper to drive the whole theme | Stylix |
| You have a specific palette (corporate, brand, base16 scheme) | Hand-rolled |
| You want fine control over every program | Hand-rolled |
| You want it to "just work" with minimum config | Stylix |

## Checklist

- [ ] One theme file (`theme/default.nix` or `modules/theme/default.nix`) — single source of truth.
- [ ] Both base16 slots and named semantic colors defined.
- [ ] Theme passed to all modules via `specialArgs` and `home-manager.extraSpecialArgs`.
- [ ] No hardcoded colors in app modules — everything reads from `theme.*`.
- [ ] Wallpaper sourced from a pinned repo (nvfetcher), not committed in the dotfiles tree.
- [ ] Cursor and GTK theme are packaged Nix derivations, not loose files.
- [ ] If using stylix, it's enabled in exactly one place.
