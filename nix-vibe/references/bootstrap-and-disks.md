# Bootstrap and Disks

Declarative disk layout with `disko`, secure boot via Lanzaboote, TPM2 LUKS auto-unlock, and the fresh-install workflow.

## `disko` — Declarative Disks

`disko` makes disk partitioning, filesystem creation, and mounting reproducible. The same Nix file describes both *how to install* and *how the system mounts at runtime*.

### Add input

```nix
inputs.disko.url = "github:nix-community/disko";
inputs.disko.inputs.nixpkgs.follows = "nixpkgs";
```

### Example: Btrfs + LUKS + TPM2 unlock + subvolumes

```nix
# hosts/phoenix/disko.nix
{
  disko.devices = {
    disk.main = {
      device = "/dev/disk/by-id/nvme-Samsung_SSD_990_PRO_2TB_S7DPNJ0X123456";
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
              # If using initial password during install
              passwordFile = "/tmp/secret.key";
              settings = {
                allowDiscards = true;
                # crypttabExtraOpts triggers TPM2 auto-unlock — see below
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
                  "@swap" = {
                    mountpoint = "/swap";
                    swap.swapfile.size = "16G";
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

Import in the host:

```nix
# hosts/phoenix/default.nix
{ inputs, ... }:
{
  imports = [
    inputs.disko.nixosModules.default
    ./disko.nix
    ./hardware-configuration.nix
  ];
}
```

### Fresh install workflow

```bash
# 1. Boot the NixOS installer ISO.
# 2. Clone your repo onto the live system.
git clone https://github.com/yourname/nix-config /mnt/nix-config

# 3. Create a temp keyfile for LUKS (will be replaced post-install)
echo -n "tempkey" > /tmp/secret.key

# 4. Apply the disko layout — destroys disk!
sudo nix run github:nix-community/disko -- \
  --mode destroy,format,mount \
  /mnt/nix-config/hosts/phoenix/disko.nix

# 5. Generate hardware config (only if you don't have one yet)
sudo nixos-generate-config --no-filesystems --root /mnt
sudo cp /mnt/etc/nixos/hardware-configuration.nix /mnt/nix-config/hosts/phoenix/

# 6. Install
sudo nixos-install --flake /mnt/nix-config#phoenix

# 7. Reboot
reboot
```

Post-install, replace the temp LUKS key with a real one:

```bash
sudo cryptsetup luksAddKey /dev/nvme0n1p2     # add real password
sudo cryptsetup luksRemoveKey /dev/nvme0n1p2 /tmp/secret.key
```

## Secure Boot with Lanzaboote

`Lanzaboote` provides UEFI Secure Boot for NixOS by signing the boot stub.

### Add input

```nix
inputs.lanzaboote.url = "github:nix-community/lanzaboote/v0.4.2";
inputs.lanzaboote.inputs.nixpkgs.follows = "nixpkgs";
```

### Configure

```nix
# hosts/phoenix/secureboot.nix
{ inputs, pkgs, ... }:
{
  imports = [ inputs.lanzaboote.nixosModules.lanzaboote ];

  environment.systemPackages = [ pkgs.sbctl ];

  # Disable systemd-boot — Lanzaboote replaces it
  boot.loader.systemd-boot.enable = false;

  boot.lanzaboote = {
    enable = true;
    pkiBundle = "/etc/secureboot";
  };
}
```

### Setup keys (once per system)

```bash
# 1. Boot in "Setup Mode" (clear factory keys in UEFI firmware first)
# 2. Create keys
sudo sbctl create-keys

# 3. Enroll keys + Microsoft KEK (for OEM-signed firmware updates)
sudo sbctl enroll-keys --microsoft

# 4. Verify
sudo sbctl status
# Should show: Setup Mode: Disabled, Secure Boot: Enabled

# 5. Rebuild — Lanzaboote signs the boot stub
sudo nixos-rebuild switch --flake .#phoenix
```

### Caveat: Setup Mode access

Some firmware requires you to physically clear factory keys before `sbctl enroll-keys` works. Read your motherboard's manual.

## TPM2 Auto-Unlock for LUKS

Combined with Lanzaboote, TPM2 lets the system unlock the disk without a password (typing one) by binding to the TPM's PCR registers (which include the boot chain).

### Configure

```nix
# hosts/phoenix/default.nix
boot.initrd.systemd.enable = true;     # required for systemd-cryptenroll
boot.initrd.luks.devices."cryptroot".crypttabExtraOpts = [
  "tpm2-device=auto"
];
```

### Enroll (post-install)

```bash
# Bind PCR 0 (firmware) + PCR 7 (Secure Boot state)
sudo systemd-cryptenroll --tpm2-device=auto \
  --tpm2-pcrs=0+7 \
  /dev/disk/by-uuid/<luks-device-uuid>

# Test: reboot — should auto-unlock
sudo reboot
```

### Caveat: PCR drift

Updating firmware, changing Secure Boot keys, or modifying boot configuration changes PCR values, breaking auto-unlock. You'll need to re-enroll. Always keep a backup unlock method:

```bash
# Add a recovery passphrase as a separate keyslot
sudo cryptsetup luksAddKey /dev/disk/by-uuid/<uuid>
```

## Memory Configuration

For desktops/laptops, configure swap and memory pressure handlers:

```nix
{ pkgs, ... }:
{
  # zram swap — compressed in-memory swap
  zramSwap = {
    enable = true;
    algorithm = "zstd";
    memoryPercent = 50;     # half of RAM
  };

  # systemd-oomd — kill memory hogs before total OOM
  systemd.oomd = {
    enable = true;
    enableRootSlice = true;
    enableSystemSlice = true;
    enableUserSlices = true;
  };

  # zswap kernel parameter (in addition to zram)
  boot.kernelParams = [ "zswap.enabled=1" ];
}
```

## Network Hardening (Desktop)

```nix
{ pkgs, ... }:
{
  networking.networkmanager = {
    enable = true;
    wifi = {
      backend = "iwd";
      powersave = false;        # disable WiFi powersave
      scanRandMacAddress = true;
    };
    settings = {
      device = {
        "wifi.scan-rand-mac-address" = "yes";
      };
      connection = {
        "wifi.cloned-mac-address" = "random";
      };
    };
  };

  networking.firewall = {
    enable = true;
    allowedTCPPorts = [];
    allowedUDPPorts = [];
  };

  # Tailscale for off-LAN access
  services.tailscale.enable = true;
}
```

## Btrfs Snapshots with Snapper

```nix
{ pkgs, ... }:
{
  services.snapper = {
    configs = {
      home = {
        SUBVOLUME = "/home";
        ALLOW_USERS = [ "pavlo" ];
        TIMELINE_CREATE = true;
        TIMELINE_CLEANUP = true;
        TIMELINE_LIMIT_HOURLY = 5;
        TIMELINE_LIMIT_DAILY = 7;
        TIMELINE_LIMIT_WEEKLY = 0;
        TIMELINE_LIMIT_MONTHLY = 0;
      };
      root = {
        SUBVOLUME = "/";
        TIMELINE_CREATE = true;
        TIMELINE_CLEANUP = true;
        TIMELINE_LIMIT_HOURLY = 5;
        TIMELINE_LIMIT_DAILY = 7;
      };
    };
  };

  services.snapper.snapshotInterval = "hourly";
  services.snapper.cleanupInterval = "1d";
}
```

## VM Bootstrap Workflow (mitchellh style)

For provisioning a fresh VM (Parallels, VMware, UTM):

### Prep — Makefile target for first install

```makefile
NIXADDR ?= unset
NIXPORT ?= 22
NIXNAME ?= vm-aarch64

vm/bootstrap0:
	ssh -p$(NIXPORT) root@$(NIXADDR) " \
		parted /dev/sda -- mklabel gpt; \
		parted /dev/sda -- mkpart primary 512MB -8GB; \
		parted /dev/sda -- mkpart primary linux-swap -8GB 100%; \
		parted /dev/sda -- mkpart ESP fat32 1MB 512MB; \
		parted /dev/sda -- set 3 esp on; \
		mkfs.ext4 -L nixos /dev/sda1; \
		mkswap -L swap /dev/sda2; \
		mkfs.fat -F 32 -n boot /dev/sda3; \
		mount /dev/disk/by-label/nixos /mnt; \
		mkdir /mnt/boot; \
		mount /dev/disk/by-label/boot /mnt/boot; \
		nixos-generate-config --root /mnt; \
		nixos-install --no-root-passwd; \
		reboot; \
	"

vm/copy:
	rsync -av --rsync-path="sudo rsync" -e 'ssh -p$(NIXPORT)' \
		--exclude='.git/' --exclude='result/' \
		./ root@$(NIXADDR):/nix-config

vm/switch:
	ssh -p$(NIXPORT) root@$(NIXADDR) \
		"nixos-rebuild switch --flake /nix-config#$(NIXNAME)"
```

Workflow:

```bash
# 1. Boot VM from NixOS ISO, set root password, get IP
# 2. Run bootstrap to install NixOS with default config
make NIXADDR=192.168.64.10 vm/bootstrap0

# 3. Copy your repo to the VM
make NIXADDR=192.168.64.10 vm/copy

# 4. Switch to your config
make NIXADDR=192.168.64.10 NIXNAME=vm-aarch64 vm/switch
```

## Hardware Configuration: Generated vs Hand-Curated

`nixos-generate-config` produces a `hardware-configuration.nix`. Two strategies:

### Strategy A — Use as-is (typical for laptops)

Re-run `nixos-generate-config` whenever hardware changes (new SSD, etc.). Commit the result. Don't edit by hand.

### Strategy B — Hand-curate (for VMs, known-stable hardware)

Mitchell's approach: lock the file and freeze it. Comment at the top notes it's a frozen artifact.

```nix
# hosts/vm-aarch64/hardware-configuration.nix
# This file is normally automatically generated. Since we build a VM and
# have full control over that hardware I can hardcode this into my repository.
{ config, lib, pkgs, modulesPath, ... }:
{
  imports = [ ];
  boot.initrd.availableKernelModules = [ "uhci_hcd" "ahci" "xhci_pci" "nvme" "usbhid" "sr_mod" ];
  boot.kernelModules = [ ];
  fileSystems."/" = { device = "/dev/disk/by-label/nixos"; fsType = "ext4"; };
  fileSystems."/boot" = { device = "/dev/disk/by-label/boot"; fsType = "vfat"; };
  swapDevices = [ ];
}
```

Use Strategy B when the hardware is fixed (VM, single-purpose appliance). Use Strategy A for everything else.

## Cross-Compile via binfmt

To build aarch64 from x86_64 (or vice versa) without a remote builder:

```nix
{ ... }:
{
  boot.binfmt.emulatedSystems = [ "aarch64-linux" ];
}
```

`qemu-user` runs the foreign-arch builder transparently. Slow but works. Useful for CI on x86_64 building ARM SD card images.

## Checklist

- [ ] Disk layout in `hosts/<host>/disko.nix` — never partition by hand.
- [ ] LUKS keyfile during install (`/tmp/secret.key`) replaced with real password post-install.
- [ ] If using Secure Boot: Lanzaboote configured, `sbctl enroll-keys --microsoft` run.
- [ ] If using TPM2 auto-unlock: at least one backup unlock method (passphrase or recovery key).
- [ ] `hardware-configuration.nix` committed to repo, not in `/etc/nixos/`.
- [ ] Memory config: zram + systemd-oomd at minimum.
- [ ] Btrfs hosts: snapper configured for `/` and `/home`.
- [ ] First-install bootstrap captured in Makefile/Justfile.
