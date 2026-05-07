# Overlays and Custom Packages

How to layer overlays, expose custom packages via flake outputs, and mix nixpkgs channels (stable + unstable + master).

## The Three-Overlay Pattern (Misterio77)

The cleanest convention for any non-trivial config. Three named overlays, each with a single purpose, exported from `overlays/default.nix`:

```nix
# overlays/default.nix
{ inputs, ... }:
{
  # 1. additions: inject your custom packages from ./pkgs into the package set
  additions = final: _prev: import ../pkgs final.pkgs;

  # 2. modifications: override existing nixpkgs packages (patches, version bumps, flags)
  modifications = final: prev: {
    # Example:
    # firefox = prev.firefox.override {
    #   extraPolicies = { DisableTelemetry = true; };
    # };
    # neovim = prev.neovim.overrideAttrs (old: {
    #   patches = (old.patches or []) ++ [ ./neovim-fix.patch ];
    # });
  };

  # 3. unstable-packages: expose nixpkgs-unstable as `pkgs.unstable`
  unstable-packages = final: _prev: {
    unstable = import inputs.nixpkgs-unstable {
      system = final.stdenv.hostPlatform.system;
      config.allowUnfree = true;
    };
  };
}
```

Apply at the **module level**, not the flake level:

```nix
# In any NixOS or home-manager module
nixpkgs.overlays = [
  inputs.self.overlays.additions
  inputs.self.overlays.modifications
  inputs.self.overlays.unstable-packages
];
```

Order matters:

1. `additions` runs first (introduces new attrs).
2. `modifications` runs next (overrides existing ones).
3. `unstable-packages` last (introduces a sub-namespace).

Then in any module:

```nix
environment.systemPackages = with pkgs; [
  my-custom-tool        # from additions (./pkgs/my-custom-tool/)
  firefox               # potentially patched by modifications
  unstable.bleeding-edge-thing  # from unstable-packages
];
```

### Why this pattern wins

- **One source of truth for custom packages** — `./pkgs/default.nix` is consumed by both `flake.packages` and the `additions` overlay.
- **Composable** — each overlay is a single named function; you can disable one easily.
- **No ad-hoc `import nixpkgs { ... }`** scattered across modules.

## Custom Packages: `pkgs/` Directory

```
pkgs/
├── default.nix              # the package map
├── my-custom-tool/
│   └── default.nix
└── another-pkg/
    └── default.nix
```

`pkgs/default.nix`:

```nix
# Custom packages, defined as a function over nixpkgs.
# Used by both flake.packages.<system> and overlays/default.nix.additions.
pkgs:
{
  my-custom-tool = pkgs.callPackage ./my-custom-tool { };
  another-pkg = pkgs.callPackage ./another-pkg { };
}
```

`pkgs/my-custom-tool/default.nix`:

```nix
{ stdenv, lib, fetchFromGitHub, makeWrapper, runtimeInputs ? [] }:

stdenv.mkDerivation rec {
  pname = "my-custom-tool";
  version = "0.1.0";

  src = fetchFromGitHub {
    owner = "user";
    repo = "tool";
    rev = "v${version}";
    hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  };

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    install -Dm755 my-custom-tool $out/bin/my-custom-tool
    wrapProgram $out/bin/my-custom-tool \
      --prefix PATH : ${lib.makeBinPath runtimeInputs}
  '';

  meta = with lib; {
    description = "My custom tool";
    homepage = "https://github.com/user/tool";
    license = licenses.mit;
    mainProgram = "my-custom-tool";
    platforms = platforms.unix;
  };
}
```

Expose via flake outputs:

```nix
# flake.nix outputs (Misterio77 standard template style)
packages = forAllSystems (system:
  import ./pkgs nixpkgs.legacyPackages.${system}
);
```

Now `nix build .#my-custom-tool` works, and the same package shows up as `pkgs.my-custom-tool` in any module after the `additions` overlay applies.

## Inline Overlays (mitchellh style)

For a small flake with 1-2 hosts, a full `overlays/` directory is overkill. Inline the overlay in `flake.nix`:

```nix
# flake.nix
outputs = { self, nixpkgs, ... }@inputs: let
  overlays = [
    inputs.jujutsu.overlays.default                    # from a flake input
    inputs.zig.overlays.default

    # Inline cherry-pick from unstable
    (final: prev: {
      gh = inputs.nixpkgs-unstable.legacyPackages.${prev.system}.gh;
      claude-code = inputs.nixpkgs-unstable.legacyPackages.${prev.system}.claude-code;
    })

    # Inline package alias / variant exposure
    (final: prev: rec {
      ibus = ibus_stable;
      ibus_stable = inputs.nixpkgs.legacyPackages.${prev.system}.ibus;
      ibus_old = inputs.nixpkgs-old-ibus.legacyPackages.${prev.system}.ibus;
    })
  ];
  mkSystem = import ./lib/mksystem.nix { inherit overlays nixpkgs inputs; };
in {
  ...
};
```

Pattern: keep all overlays in one place (the let binding), then `mkSystem` wires them in via `{ nixpkgs.overlays = overlays; }`.

## Mixing Stable + Unstable

Three approaches; pick one and stay consistent.

### Approach 1 — `unstable` namespace via overlay (Misterio77 / mitchellh)

```nix
# In overlays/default.nix
unstable-packages = final: _prev: {
  unstable = import inputs.nixpkgs-unstable {
    system = final.stdenv.hostPlatform.system;
    config.allowUnfree = true;
  };
};

# In modules
environment.systemPackages = [ pkgs.firefox pkgs.unstable.zig ];
```

**Pros:** simple, no specialArgs plumbing.
**Cons:** `pkgs.unstable.foo` references look slightly odd.

### Approach 2 — `pkgs-stable` / `pkgs-unstable` via specialArgs (ryan4yin)

```nix
# In outputs/default.nix
genSpecialArgs = system: inputs // {
  pkgs-stable = import inputs.nixpkgs-stable { inherit system; config.allowUnfree = true; };
  pkgs-master = import inputs.nixpkgs-master { inherit system; config.allowUnfree = true; };
};

# In modules
{ pkgs, pkgs-stable, ... }:
{
  environment.systemPackages = [ pkgs.firefox pkgs-stable.libreoffice ];
}
```

**Pros:** explicit which channel each package comes from.
**Cons:** more specialArgs plumbing; multiple `import nixpkgs` calls cost eval time.

### Approach 3 — Cherry-pick specific packages from another channel (mitchellh)

```nix
# In flake.nix overlays
(final: prev: {
  # Pull just these from unstable; rest stays stable
  gh = inputs.nixpkgs-unstable.legacyPackages.${prev.system}.gh;
  claude-code = inputs.nixpkgs-unstable.legacyPackages.${prev.system}.claude-code;
})
```

**Pros:** the rest of the config doesn't know there are two channels.
**Cons:** the override list grows over time; harder to audit.

### Choosing

| Scale | Approach |
|---|---|
| 1-3 packages from unstable | Cherry-pick (Approach 3) |
| Want a clear opt-in namespace | `unstable` overlay (Approach 1) |
| Many hosts, want each package's source explicit | specialArgs (Approach 2) |

Don't mix more than two approaches in one repo.

## `unfree` and `insecure` Packages

```nix
# Allow unfree packages globally
nixpkgs.config.allowUnfree = true;

# Allow specific unfree packages by name
nixpkgs.config.allowUnfreePredicate = pkg:
  builtins.elem (lib.getName pkg) [
    "vscode"
    "discord"
    "spotify"
  ];

# Allow insecure (unmaintained) packages — last resort
nixpkgs.config.permittedInsecurePackages = [
  "openssl-1.1.1w"
];
```

Set these in `mkSystem` (so all modules inherit) or in a dedicated `modules/common/nixpkgs-config.nix`.

## Patching a nixpkgs Package

If a package has a bug fixed upstream but not in your channel:

```nix
# overlays/default.nix
modifications = final: prev: {
  somepkg = prev.somepkg.overrideAttrs (old: {
    patches = (old.patches or []) ++ [
      (final.fetchpatch {
        url = "https://github.com/upstream/somepkg/commit/abc123.patch";
        hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
      })
    ];
  });
};
```

For a wholesale version override:

```nix
modifications = final: prev: {
  somepkg = prev.somepkg.overrideAttrs (old: rec {
    version = "2.5.0";
    src = final.fetchFromGitHub {
      owner = "upstream";
      repo = "somepkg";
      rev = "v${version}";
      hash = "sha256-AAAAA...";
    };
  });
};
```

## Common Pitfalls

### Pitfall 1 — `import nixpkgs { ... }` inside a module

```nix
# BAD
{ pkgs, ... }:
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

This re-imports nixpkgs for every module that does it — slow eval, doubled closure. Use the overlay or specialArgs approach instead.

### Pitfall 2 — Overlay function takes `_prev` when it needs `prev`

```nix
# BAD: shadows the previous package set; can't reference prev.foo
my-overlay = final: _prev: { foo = final.callPackage ./foo {}; };

# GOOD: when you need to reference existing packages
my-overlay = final: prev: {
  foo = prev.foo.override { withFeature = true; };
};

# OK: when introducing entirely new attrs (no existing pkg of same name)
my-overlay = final: _prev: { my-new-tool = final.callPackage ./my-new-tool {}; };
```

Use `final` to compose with later overlays, `prev` to override existing attrs, `_prev` only when you genuinely don't reference the prior package set.

### Pitfall 3 — Forgetting `final.callPackage`

```nix
# BAD: uses prev's pkgs, which may not have your earlier overlay's additions
my-overlay = final: prev: { foo = prev.callPackage ./foo {}; };

# GOOD: uses final, picking up everything composed so far
my-overlay = final: prev: { foo = final.callPackage ./foo {}; };
```

### Pitfall 4 — Mixing `pkgs.unstable.x` and `pkgs-unstable.x`

If you decide to switch from approach 1 to approach 2 (or vice versa), do it in one PR across the whole repo. Mixed conventions are confusing to read.

### Pitfall 5 — `nixpkgs.config` set in multiple places

Setting `nixpkgs.config.allowUnfree` in `mkSystem` and again in each module causes confusing errors. Set it once, in `mkSystem` or in `modules/common/`.

## Checklist

- [ ] One overlay file (`overlays/default.nix`) or one inline overlay block in `flake.nix`.
- [ ] Custom packages live in `pkgs/<name>/default.nix`, exposed via `flake.packages.*` and the `additions` overlay.
- [ ] Stable + unstable approach is chosen and consistent (Approach 1, 2, or 3 from above).
- [ ] `nixpkgs.config.allowUnfree` set in exactly one place.
- [ ] No `import nixpkgs { ... }` inside non-flake module files.
- [ ] Overlay functions use `final.callPackage`, not `prev.callPackage`.
