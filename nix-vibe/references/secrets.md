# Secrets: sops-nix and agenix

Authoritative reference for managing secrets in Nix configurations. Covers sops-nix (recommended default), agenix (simpler alternative), the comparison, and common pitfalls.

## Choosing Between sops-nix and agenix

| Aspect | sops-nix | agenix |
|---|---|---|
| Backend | Mozilla `sops` (YAML/JSON/INI/dotenv/binary) | `age` only (one file per secret) |
| File format | Structured (multiple secrets per file) | One secret per `.age` file |
| Recipients spec | `.sops.yaml` `creation_rules` with regex + key groups | `secrets.nix` mapping each `.age` file → list of public keys |
| Re-key on recipient change | `sops updatekeys` (re-wraps data key — cheap) | `agenix -r` (re-encrypts every file) |
| SSH host keys as decryption keys | Yes (`sshKeyPaths` via `ssh-to-age`) | Yes (`identityPaths`) |
| home-manager support | First-class module | Community modules |
| nix-darwin support | First-class module | Community modules |
| Templates with placeholders | `sops.templates.<x>.content` + `sops.placeholder.<y>` | Not built-in |
| KMS support (AWS / GCP / Vault) | Yes | No |
| Validation at eval time | Yes (`validateSopsFiles`) | No |

**Pick sops-nix when:**
- You manage 3+ hosts (cheap re-keying matters).
- You need YAML/JSON files with multiple secrets per file.
- You want template rendering (concatenating multiple secrets into one config file).
- You may use KMS later.

**Pick agenix when:**
- One secret = one file matches your mental model.
- You prefer Nix-native recipient declaration (`secrets.nix`) over a YAML side file.
- You don't need templates or KMS.

Both can coexist in the same repo.

## sops-nix Quickstart

### 1. Add the input

```nix
# flake.nix
inputs.sops-nix.url = "github:Mic92/sops-nix";
inputs.sops-nix.inputs.nixpkgs.follows = "nixpkgs";
```

### 2. Create `.sops.yaml` at repo root

```yaml
keys:
  - &admin_pavlo  age1youradminkeyhere...
  - &host_phoenix age1phoenixhostkeyhere...
  - &host_jade    age1jadehostkeyhere...

creation_rules:
  # Per-host secrets: only that host + admins can decrypt.
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

  # Shared secrets (every host can decrypt).
  - path_regex: secrets/shared/[^/]+\.(yaml|json|env|ini)$
    key_groups:
      - age:
          - *admin_pavlo
          - *host_phoenix
          - *host_jade
```

> **Critical** — under one `key_groups:` entry, list multiple recipient types (`age:`, `pgp:`) as **nested mappings**, not as `-`-prefixed list items. A leading `-` introduces a *new group*, which triggers Shamir secret sharing and breaks normal sops-nix usage.

### 3. Get host public keys

For each host, derive its age public key from its SSH ed25519 host key:

```bash
nix-shell -p ssh-to-age --run \
  'cat /etc/ssh/ssh_host_ed25519_key.pub | ssh-to-age'
# → age1phoenixhostkeyhere...
```

If you can't SSH yet, scan over the network:

```bash
nix-shell -p ssh-to-age --run \
  'ssh-keyscan -t ed25519 phoenix.local | ssh-to-age'
```

### 4. Generate your admin age key (once, on your workstation)

```bash
mkdir -p ~/.config/sops/age
nix-shell -p age --run 'age-keygen -o ~/.config/sops/age/keys.txt'
nix-shell -p age --run 'age-keygen -y ~/.config/sops/age/keys.txt'
# → age1youradminkeyhere... (paste this into .sops.yaml as &admin_pavlo)
```

### 5. Edit a secret

```bash
nix-shell -p sops --run 'sops secrets/phoenix/secrets.yaml'
```

Inside the editor (sops opens decrypted, encrypts on save):

```yaml
github_token: ghp_xxxxxxxxxxxxxxxxxxxxxx

myservice:
  api_key: sk-xxxxxxxxx
  db_password: hunter2

ssh_key: |
  -----BEGIN OPENSSH PRIVATE KEY-----
  ...
  -----END OPENSSH PRIVATE KEY-----
```

### 6. Wire into NixOS

```nix
# hosts/phoenix/default.nix or modules/secrets.nix
{ config, inputs, ... }:
{
  imports = [ inputs.sops-nix.nixosModules.sops ];

  sops.defaultSopsFile = ../../secrets/phoenix/secrets.yaml;
  sops.age.sshKeyPaths = [ "/etc/ssh/ssh_host_ed25519_key" ];

  # Optional: maintain a separate age key (not the SSH host key)
  # sops.age.keyFile = "/var/lib/sops-nix/key.txt";
  # sops.age.generateKey = true;

  sops.secrets.github_token = { };
  sops.secrets."myservice/api_key" = {
    owner = config.users.users.myservice.name;
    mode = "0400";
    restartUnits = [ "myservice.service" ];
  };
  sops.secrets.ssh_key = {
    path = "/root/.ssh/id_ed25519";
    mode = "0600";
  };
}
```

### 7. Consume secrets

Secrets are **not** available at eval time — only their *paths* are. Pass paths to services:

```nix
# Correct — pass the path
services.myservice.passwordFile = config.sops.secrets."myservice/db_password".path;

# Correct — systemd LoadCredential
systemd.services.myservice.serviceConfig.LoadCredential =
  "api_key:${config.sops.secrets."myservice/api_key".path}";

# WRONG — secret content not available at eval
services.myservice.password = builtins.readFile config.sops.secrets."myservice/db_password".path;
```

### 8. Deploy and verify

```bash
sudo nixos-rebuild switch --flake .#phoenix
ls -la /run/secrets/
cat /run/secrets/github_token
```

Secrets are decrypted into `/run/secrets.d/<gen>/` and symlinked from `/run/secrets/<name>`.

## sops-nix Common Patterns

### Per-secret options

```nix
sops.secrets.example = {
  sopsFile = ../secrets/special.yaml;     # override defaultSopsFile
  format = "yaml";                         # yaml | json | ini | dotenv | binary
  key = "different-yaml-key";              # if attr name ≠ key in YAML
  path = "/etc/myservice/secret.key";      # custom output path (default /run/secrets/<name>)
  owner = "myservice";
  group = "myservice";
  mode = "0400";
  neededForUsers = false;                  # see "neededForUsers" pattern below
  restartUnits = [ "myservice.service" ];
  reloadUnits = [ "nginx.service" ];
};
```

### Templates (concatenating secrets)

```nix
sops.secrets.db_password = { };
sops.secrets.api_key = { };

sops.templates."app.env".content = ''
  DB_PASSWORD=${config.sops.placeholder.db_password}
  API_KEY=${config.sops.placeholder.api_key}
'';

systemd.services.myapp.serviceConfig.EnvironmentFile =
  config.sops.templates."app.env".path;
```

`config.sops.placeholder.<name>` evaluates to a unique string at eval time; the actual secret value is substituted at activation.

### `neededForUsers` (declarative login passwords)

Secrets normally provision *after* users are created. To set `users.users.<name>.hashedPasswordFile` declaratively, the secret must be available *before* user creation. Use `neededForUsers`:

```nix
sops.secrets.user_password.neededForUsers = true;

users.users.pavlo = {
  hashedPasswordFile = config.sops.secrets.user_password.path;
};
```

Constraint: secrets with `neededForUsers = true` cannot have `owner`/`group` (the user doesn't exist yet) and live under a separate manifest.

### Restart on rotation

```nix
sops.secrets.api_key = {
  owner = "myapp";
  restartUnits = [ "myapp.service" ];      # full restart on secret change
  reloadUnits = [ "nginx.service" ];        # SIGHUP-style reload
};
```

The encrypted file's hash drives systemd `restartTriggers`. Rotating the value triggers the listed units.

## sops-nix Workflow Commands

```bash
# Edit (decrypts, opens $EDITOR, re-encrypts on save)
sops secrets/phoenix/secrets.yaml

# Add new recipient — re-wrap data key for all affected files
find secrets -name "*.yaml" -exec sops updatekeys -y {} \;

# Rotate the data key itself (forward secrecy)
find secrets -name "*.yaml" -exec sops -r -i {} \;

# Inspect what will be deployed
nix build .#nixosConfigurations.phoenix.config.system.build.sops-nix-manifest
cat result | jq .

# Re-encrypt with new YAML format settings (after upgrading sops or .sops.yaml)
sops updatekeys secrets/phoenix/secrets.yaml
```

## sops-nix Common Pitfalls

### Pitfall 1 — Forgetting `sops updatekeys` after editing `.sops.yaml`

Adding/removing a recipient in `.sops.yaml` does **not** automatically re-wrap existing files. You must run `sops updatekeys` on every affected file. Otherwise the new host can't decrypt, or the removed key can still decrypt.

### Pitfall 2 — Shamir secret sharing trap

Listing two `key_groups` (with leading `-`) instead of one mapping with multiple recipient types triggers Shamir splitting:

```yaml
# WRONG — Shamir 1-of-2: each group can decrypt independently, BUT requires careful handling
creation_rules:
  - path_regex: secrets/.+\.yaml$
    key_groups:
      - age: [ *admin_pavlo ]
      - age: [ *host_phoenix ]    # NEW GROUP!

# RIGHT — single group with both recipients
creation_rules:
  - path_regex: secrets/.+\.yaml$
    key_groups:
      - age:
          - *admin_pavlo
          - *host_phoenix
```

### Pitfall 3 — Binary files

For binary secrets (TLS keys, GPG keys), set `format = "binary"` and put the content in a separate file:

```nix
sops.secrets.tls_key = {
  format = "binary";
  sopsFile = ../secrets/phoenix/tls.key;    # one file = one binary secret
  owner = "nginx";
  mode = "0400";
};
```

### Pitfall 4 — Password-protected SSH keys

`sops-install-secrets` cannot enter passphrases. Either use unencrypted SSH host keys for sops, or provision a separate age key file (`sops.age.keyFile`).

### Pitfall 5 — Initrd secrets

Secrets in `/run/secrets/` are not available during early boot (initrd). For secrets needed at boot (LUKS keyfiles, etc.), use a different mechanism (e.g. TPM2, systemd-cryptenroll).

### Pitfall 6 — Cleartext leakage in nix-store

The encrypted file is copied into the Nix store by default (it's still encrypted, but the *path* exposes filename). Set `sops.validateSopsFiles = false` to skip the store copy if you'd rather keep paths private.

### Pitfall 7 — Eval-time secret access

`builtins.readFile config.sops.secrets.foo.path` returns the **encrypted** file content (or the placeholder path), not the secret. Secrets are only readable at *runtime* by services that have permission.

## agenix Quickstart

### 1. Add input

```nix
inputs.agenix.url = "github:ryantm/agenix";
inputs.agenix.inputs.nixpkgs.follows = "nixpkgs";
```

### 2. Create `secrets/secrets.nix`

```nix
let
  pavlo = "ssh-ed25519 AAAAC3...pavlo@admin";
  phoenix = "ssh-ed25519 AAAAC3...root@phoenix";
  jade = "ssh-ed25519 AAAAC3...root@jade";

  hosts = [ phoenix jade ];
  admins = [ pavlo ];
in
{
  "github-token.age".publicKeys = admins ++ [ phoenix ];
  "ssh-key.age".publicKeys = admins ++ [ phoenix ];
  "shared.age".publicKeys = admins ++ hosts;
}
```

### 3. Edit a secret

```bash
nix run github:ryantm/agenix -- -e secrets/github-token.age
```

### 4. Wire NixOS

```nix
{ config, inputs, ... }:
{
  imports = [ inputs.agenix.nixosModules.default ];

  age.identityPaths = [ "/etc/ssh/ssh_host_ed25519_key" ];

  age.secrets.github_token.file = ../secrets/github-token.age;
  age.secrets.ssh_key = {
    file = ../secrets/ssh-key.age;
    path = "/root/.ssh/id_ed25519";
    mode = "0600";
  };
}
```

### 5. Consume

```nix
systemd.services.myservice.serviceConfig.EnvironmentFile =
  config.age.secrets.github_token.path;
```

## Bootstrap: Chicken-and-Egg

The fundamental problem: secrets need a key to decrypt; the key lives on the host; the host doesn't exist yet.

### Solution 1 — Use SSH host keys (recommended)

NixOS generates `/etc/ssh/ssh_host_ed25519_key` on first boot if `services.openssh.enable = true`. After first boot:

1. Boot host with no secrets enabled (`sops.secrets = {}` or commented out).
2. SSH in, retrieve `/etc/ssh/ssh_host_ed25519_key.pub`.
3. Convert with `ssh-to-age`, add to `.sops.yaml`.
4. Run `sops updatekeys` to re-wrap secrets for the new host.
5. Pull repo, rebuild — now secrets decrypt.

This is what `sops.age.sshKeyPaths = [ "/etc/ssh/ssh_host_ed25519_key" ]` does.

### Solution 2 — Generate a separate age key

```nix
sops.age.keyFile = "/var/lib/sops-nix/key.txt";
sops.age.generateKey = true;    # auto-generated on first activation if missing
```

After first activation:

```bash
sudo cat /var/lib/sops-nix/key.txt | nix-shell -p age --run 'age-keygen -y'
# Add the output to .sops.yaml; sops updatekeys.
```

### Solution 3 — Out-of-band

Provision the age key via a USB stick, encrypted disk image, or cloud secret manager. Used in immutable / impermanence setups where `/var/lib/sops-nix/` doesn't persist.

## Comparison Cheat Sheet

```bash
# sops-nix workflow
nix-shell -p age --run 'age-keygen -o ~/.config/sops/age/keys.txt'
nix-shell -p ssh-to-age --run 'cat /etc/ssh/ssh_host_ed25519_key.pub | ssh-to-age'
sops secrets/host/secrets.yaml                                       # edit
find secrets -name "*.yaml" -exec sops updatekeys -y {} \;          # re-key all
nix build .#nixosConfigurations.host.config.system.build.sops-nix-manifest

# agenix workflow
nix run github:ryantm/agenix -- -e secrets/foo.age                  # edit
nix run github:ryantm/agenix -- -r                                   # re-key all (after secrets.nix changes)
```

## Minimum Working Examples

### Minimum sops-nix NixOS module

```nix
{ inputs, ... }:
{
  imports = [ inputs.sops-nix.nixosModules.sops ];

  sops.defaultSopsFile = ./secrets.yaml;
  sops.age.sshKeyPaths = [ "/etc/ssh/ssh_host_ed25519_key" ];

  sops.secrets.my_secret = { };
}
```

### Minimum sops-nix home-manager module

```nix
{ config, inputs, ... }:
{
  imports = [ inputs.sops-nix.homeManagerModules.sops ];

  sops.age.keyFile = "${config.home.homeDirectory}/.config/sops/age/keys.txt";
  sops.defaultSopsFile = ./secrets.yaml;

  sops.secrets.my_secret = { };
}
```

### Minimum agenix NixOS module

```nix
{ inputs, ... }:
{
  imports = [ inputs.agenix.nixosModules.default ];

  age.identityPaths = [ "/etc/ssh/ssh_host_ed25519_key" ];
  age.secrets.my_secret.file = ./secrets/my-secret.age;
}
```

## Checklist

- [ ] `.sops.yaml` (or `secrets.nix`) at repo root — never committed cleartext.
- [ ] Host public keys collected from each `/etc/ssh/ssh_host_ed25519_key.pub` via `ssh-to-age`.
- [ ] Admin age key in `~/.config/sops/age/keys.txt` (excluded from repo).
- [ ] Per-host secrets under `secrets/<host>/` with regex matching in `.sops.yaml`.
- [ ] `sops.age.sshKeyPaths` (or `age.identityPaths`) set on every host.
- [ ] Services consume `config.sops.secrets.<name>.path`, never `builtins.readFile` of it.
- [ ] `restartUnits` set on secrets that drive service config.
- [ ] `sops updatekeys` runs after every `.sops.yaml` change.
- [ ] `nix build .#nixosConfigurations.<host>.config.system.build.sops-nix-manifest` works.
