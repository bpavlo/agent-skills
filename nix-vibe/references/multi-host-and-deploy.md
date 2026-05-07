# Multi-Host and Deployment

Patterns for managing many machines from one flake: centralized vars, derived networking, and remote deployment with colmena or deploy-rs.

## When You Have ≥3 Hosts

The cost shifts from "one big config file" to "duplication across hosts". Three patterns help:

1. **Centralized `vars/`** — username, email, network topology in one place.
2. **Derived networking** — generate `networking.interfaces` blocks from a hosts table.
3. **Remote deploy** — `colmena` or `deploy-rs` to push to remote hosts.

## Centralized `vars/`

This is the highest-value pattern in any multi-host config. Inspired by **ryan4yin/nix-config**.

```nix
# vars/default.nix
{ lib }:
{
  username = "pavlo";
  fullname = "Pavlo";
  email = "pavlo@example.com";

  # mkpasswd -m yescrypt --rounds=11
  initialHashedPassword = "$y$jFT$...";

  # Public keys authorized to SSH into ALL hosts
  authorizedKeys = [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... pavlo@admin"
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

  # Single source of truth for every host's interface + static IP
  hosts = {
    phoenix    = { iface = "wlp1s0"; ipv4 = "192.168.1.10"; };
    jade       = { iface = "en0";    ipv4 = "192.168.1.11"; };
    server     = { iface = "eno1";   ipv4 = "192.168.1.20"; };
    backup     = { iface = "eno1";   ipv4 = "192.168.1.21"; };
  };

  # Auto-derive networking.interfaces blocks
  hostsInterface = lib.attrsets.mapAttrs (_: val: {
    interfaces."${val.iface}" = {
      useDHCP = false;
      ipv4.addresses = [{ inherit prefixLength; address = val.ipv4; }];
    };
  }) hosts;

  # Auto-derive /etc/ssh/ssh_config aliases
  sshConfigAliases = lib.attrsets.foldlAttrs
    (acc: host: val: acc + ''
      Host ${host}
        HostName ${val.ipv4}
        Port 22
    '')
    "" hosts;

  # Auto-derive ssh known_hosts (you must populate publicKey per host)
  knownHosts = lib.mapAttrs
    (host: val: {
      hostNames = [ host val.ipv4 ];
      publicKey = val.publicKey or "";
    })
    hosts;
}
```

Then in `mkSystem`:

```nix
specialArgs = {
  inherit inputs mylib myvars;
};
```

In any module:

```nix
{ myvars, currentSystemName, ... }:
{
  networking.hostName = currentSystemName;
  networking = myvars.networking.hostsInterface.${currentSystemName};
  networking.defaultGateway = myvars.networking.gateway;
  networking.nameservers = myvars.networking.nameservers;

  users.users.${myvars.username} = {
    isNormalUser = true;
    initialHashedPassword = myvars.initialHashedPassword;
    openssh.authorizedKeys.keys = myvars.authorizedKeys;
  };
}
```

Adding a host = one entry in `vars/networking.nix` + one host file. Network plumbing auto-generates.

## Per-Host Files Under `outputs/<system>/src/`

Once you have ≥5 hosts, drop one file per host (see `flake-architecture.md` for the `outputs/` directory pattern).

```nix
# outputs/x86_64-linux/src/phoenix.nix
{ inputs, lib, mylib, myvars, system, genSpecialArgs, ... }@args:
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

For homelab/server hosts, add `colmena` and `packages` outputs:

```nix
{
  nixosConfigurations.${name} = mylib.nixosSystem  systemArgs;
  colmena.${name}             = mylib.colmenaSystem (systemArgs // { tags = [ name ]; ssh-user = "root"; });
  packages.${name}            = inputs.self.nixosConfigurations.${name}.config.formats.kubevirt;
}
```

The same module list produces:

- `nixos-rebuild switch --flake .#phoenix` — local rebuild
- `colmena apply --on phoenix` — remote SSH deploy
- `nix build .#phoenix` — qcow2/iso/kubevirt VM image

## Remote Deployment: `colmena`

Add the input:

```nix
inputs.colmena.url = "github:zhaofengli/colmena";
inputs.colmena.inputs.nixpkgs.follows = "nixpkgs";
```

Define `colmena` outputs (the structure colmena expects):

```nix
# outputs/default.nix
colmena = {
  meta = (let
    system = "x86_64-linux";
  in {
    nixpkgs = import nixpkgs { inherit system; };
    specialArgs = genSpecialArgs system;
  }) // {
    nodeNixpkgs = lib.attrsets.mergeAttrsList (
      map (it: it.colmenaMeta.nodeNixpkgs or {}) (builtins.attrValues nixosSystems)
    );
    nodeSpecialArgs = lib.attrsets.mergeAttrsList (
      map (it: it.colmenaMeta.nodeSpecialArgs or {}) (builtins.attrValues nixosSystems)
    );
  };
} // lib.attrsets.mergeAttrsList (
  map (it: it.colmena or {}) (builtins.attrValues nixosSystems)
);
```

Then `lib/colmenaSystem.nix`:

```nix
{ lib, inputs, nixos-modules, home-modules ? [], myvars, system, tags, ssh-user, genSpecialArgs, specialArgs ? (genSpecialArgs system), ... }:
let
  inherit (inputs) home-manager;
in
{ name, ... }:
{
  deployment = {
    inherit tags;
    targetUser = ssh-user;
    targetHost = name;
  };

  imports = nixos-modules ++ (lib.optionals ((lib.length home-modules) > 0) [
    home-manager.nixosModules.home-manager
    {
      home-manager.useGlobalPkgs = true;
      home-manager.useUserPackages = true;
      home-manager.extraSpecialArgs = specialArgs;
      home-manager.users.${myvars.username}.imports = home-modules;
    }
  ]);
}
```

Deploy:

```bash
colmena apply --on phoenix                # one host
colmena apply --on '@servers'             # by tag
colmena apply                             # all
colmena exec --on '@servers' uptime       # ad-hoc command on tagged hosts
```

## Remote Deployment: `deploy-rs`

`deploy-rs` is the alternative. Smaller surface area; "build locally, push closure, activate remotely" model.

```nix
# flake.nix
inputs.deploy-rs.url = "github:serokell/deploy-rs";
inputs.deploy-rs.inputs.nixpkgs.follows = "nixpkgs";

# In outputs:
deploy.nodes = {
  phoenix = {
    hostname = "phoenix.local";
    sshUser = "root";
    profiles.system = {
      user = "root";
      path = inputs.deploy-rs.lib.x86_64-linux.activate.nixos
        self.nixosConfigurations.phoenix;
    };
  };
};
```

Deploy:

```bash
nix run github:serokell/deploy-rs -- --hostname phoenix.local
```

### Choosing colmena vs deploy-rs

| Aspect | colmena | deploy-rs |
|---|---|---|
| Typical scale | 5+ hosts | 1-10 hosts |
| Tags / parallel | Yes (tags + parallelism) | Yes |
| Rollback | Manual | Automatic on failed activation |
| Local builds | Optional | Default |
| Secrets workflow | Standard sops/agenix | Same |
| Learning curve | Higher | Lower |

## Makefile / Justfile Entry Points

Keep a stable entry-point command file. Two common shapes.

### Makefile (mitchellh style)

```makefile
NIXNAME ?= phoenix
UNAME := $(shell uname)

.PHONY: switch test build cache fmt

switch:
ifeq ($(UNAME), Darwin)
	NIXPKGS_ALLOW_UNFREE=1 nix build --impure ".#darwinConfigurations.${NIXNAME}.system"
	sudo NIXPKGS_ALLOW_UNFREE=1 ./result/sw/bin/darwin-rebuild switch --impure --flake "$$(pwd)#${NIXNAME}"
else
	sudo NIXPKGS_ALLOW_UNFREE=1 nixos-rebuild switch --impure --flake ".#${NIXNAME}"
endif

test:
	sudo nixos-rebuild test --flake ".#${NIXNAME}"

build:
	nix build ".#nixosConfigurations.${NIXNAME}.config.system.build.toplevel"

fmt:
	nix fmt

check:
	nix flake check

up:
	nix flake update --commit-lock-file
```

### Justfile (ryan4yin style)

```just
set shell := ["bash", "-uc"]

default:
    @just --list

# Build and switch the current host
local mode="default":
    sudo nixos-rebuild switch --flake .#$(hostname)

# Build only (no activation)
build host=`hostname`:
    nix build .#nixosConfigurations.{{host}}.config.system.build.toplevel

# Test (activate without setting boot default)
test host=`hostname`:
    sudo nixos-rebuild test --flake .#{{host}}

# Update flake inputs
up:
    nix flake update --commit-lock-file

# Update one input
upp input:
    nix flake update {{input}} --commit-lock-file

# Format Nix files
fmt:
    nix fmt

# Run all checks
check:
    nix flake check

# Garbage collect older than 7 days
gc:
    sudo nix-collect-garbage --delete-older-than 7d
    nix-collect-garbage --delete-older-than 7d

# Deploy via colmena
deploy host:
    colmena apply --on {{host}}

# Deploy a tag
deploy-tag tag:
    colmena apply --on '@{{tag}}'
```

Just is more flexible for parameterized commands. Make is universally available. Pick by team familiarity.

## Eval Tests

Once you have ≥5 hosts, eval tests catch typos before deploy. Pattern from ryan4yin using `haumea`:

```nix
# outputs/x86_64-linux/tests/hostname/expr.nix
{ outputs, ... }: outputs.nixosConfigurations.phoenix.config.networking.hostName

# outputs/x86_64-linux/tests/hostname/expected.nix
"phoenix"
```

Wire in:

```nix
# outputs/x86_64-linux/default.nix
evalTests = haumea.lib.loadEvalTests {
  src = ./tests;
  inputs = args // { inherit outputs; };
};
```

```nix
# outputs/default.nix
evalTests = lib.lists.all (it: it.evalTests == {}) allSystemValues;

checks = forAllSystems (system: {
  eval-tests = allSystems.${system}.evalTests == {};
});
```

Run with `nix flake check` or `nix eval .#evalTests`.

## CI Checks

Even for a personal config, run formatting + lint as a `nix flake check`:

```nix
# flake.nix
inputs.pre-commit-hooks.url = "github:cachix/git-hooks.nix";
inputs.pre-commit-hooks.inputs.nixpkgs.follows = "nixpkgs";

# In outputs:
checks = forAllSystems (system: {
  pre-commit-check = inputs.pre-commit-hooks.lib.${system}.run {
    src = ./.;
    hooks = {
      nixfmt-rfc-style.enable = true;
      deadnix.enable = true;
      statix.enable = true;
      typos = {
        enable = true;
        settings.write = true;
      };
    };
  };
});

devShells = forAllSystems (system: {
  default = nixpkgs.legacyPackages.${system}.mkShell {
    inherit (self.checks.${system}.pre-commit-check) shellHook;
    packages = with nixpkgs.legacyPackages.${system}; [
      git nixfmt deadnix statix typos
    ];
  };
});
```

`nix develop` activates the shell with hooks installed.

## Checklist

- [ ] `vars/default.nix` is the single source for username, email, password, SSH keys.
- [ ] `vars/networking.nix` enumerates all hosts with `iface` + `ipv4`.
- [ ] `networking.interfaces.*` is **derived** from the hosts table, never hardcoded per host.
- [ ] Per-host file under `outputs/<system>/src/<host>.nix` (when ≥5 hosts).
- [ ] One entry-point command file (Makefile or Justfile) at repo root.
- [ ] `nix flake check` runs formatting + lint hooks.
- [ ] Decided colmena vs deploy-rs vs neither (local-only) and stuck with it.
