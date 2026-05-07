#!/usr/bin/env node
// agent-skills — manage personal skills for AI coding agents.
// Zero dependencies, ESM, Node >= 18.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { argv, env, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const REPO_URL = "https://github.com/bpavlo/agent-skills.git";
const HOME = homedir();
const XDG_DATA_HOME = env.XDG_DATA_HOME || join(HOME, ".local", "share");
const INSTALL_DIR = join(XDG_DATA_HOME, "agent-skills");
const AGENTS_DIR = join(HOME, ".agents", "skills");
const CLAUDE_DIR = join(HOME, ".claude", "skills");

const HELP = `agent-skills — manage personal skills for AI coding agents

Usage:
  agent-skills install [<name>...]      Install all skills, or named ones
  agent-skills update                   Pull latest changes from origin
  agent-skills list                     List available skills
  agent-skills uninstall [<name>...]    Remove symlinks (all, or named)
  agent-skills path                     Print the install directory
  agent-skills --help                   Show this help
  agent-skills --version                Show version

Examples:
  npx github:bpavlo/agent-skills install
  npx github:bpavlo/agent-skills install nix-vibe
  npx github:bpavlo/agent-skills update

Files:
  Repo:               ${INSTALL_DIR}
  opencode skills:    ${AGENTS_DIR}
  Claude Code skills: ${CLAUDE_DIR} (linked only if parent exists)
`;

const log = (msg) => stdout.write(msg + "\n");
const warn = (msg) => stderr.write(msg + "\n");
const fail = (msg, code = 1) => {
  stderr.write(msg + "\n");
  exit(code);
};

function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function ensureRepo() {
  if (existsSync(join(INSTALL_DIR, ".git"))) {
    log(`updating ${INSTALL_DIR}...`);
    git(["pull", "--ff-only"], INSTALL_DIR);
    return;
  }
  if (existsSync(INSTALL_DIR)) {
    fail(`${INSTALL_DIR} exists but is not a git repo. Move it aside and retry.`);
  }
  mkdirSync(dirname(INSTALL_DIR), { recursive: true });
  log(`cloning ${REPO_URL} into ${INSTALL_DIR}...`);
  git(["clone", "--depth=1", REPO_URL, INSTALL_DIR]);
}

function listSkills() {
  if (!existsSync(INSTALL_DIR)) return [];
  return readdirSync(INSTALL_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .filter((d) => existsSync(join(INSTALL_DIR, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort();
}

function lstatSafe(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function installOne(name) {
  const src = join(INSTALL_DIR, name);
  if (!existsSync(join(src, "SKILL.md"))) {
    warn(`skip: ${name} — no SKILL.md at ${src}`);
    return false;
  }

  for (const dir of [AGENTS_DIR, CLAUDE_DIR]) {
    if (dir === CLAUDE_DIR && !existsSync(dirname(dir))) continue;
    mkdirSync(dir, { recursive: true });
    const link = join(dir, name);

    const stat = lstatSafe(link);
    if (stat) {
      if (stat.isSymbolicLink()) {
        unlinkSync(link);
      } else {
        warn(`error: ${link} exists and is not a symlink. Refusing to overwrite.`);
        return false;
      }
    }
    symlinkSync(src, link);
    log(`linked: ${link} -> ${src}`);
  }
  return true;
}

function uninstallOne(name) {
  for (const base of [AGENTS_DIR, CLAUDE_DIR]) {
    const link = join(base, name);
    const stat = lstatSafe(link);
    if (!stat || !stat.isSymbolicLink()) continue;
    const target = resolve(base, readlinkSync(link));
    if (target === INSTALL_DIR || target.startsWith(INSTALL_DIR + "/")) {
      unlinkSync(link);
      log(`removed: ${link}`);
    } else {
      log(`skip: ${link} -> ${target} (not managed by this repo)`);
    }
  }
}

async function readVersion() {
  try {
    const pkgPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

async function main() {
  const args = argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "-h" || cmd === "--help") {
    stdout.write(HELP);
    return;
  }
  if (cmd === "--version" || cmd === "-v") {
    log(await readVersion());
    return;
  }

  switch (cmd) {
    case "path":
      log(INSTALL_DIR);
      return;

    case "list": {
      ensureRepo();
      const skills = listSkills();
      if (skills.length === 0) {
        warn("no skills found");
        exit(1);
      }
      for (const name of skills) log(name);
      return;
    }

    case "install": {
      ensureRepo();
      const requested = args.slice(1);
      const targets = requested.length > 0 ? requested : listSkills();
      if (targets.length === 0) fail("no skills found in repo");

      let failed = 0;
      for (const name of targets) {
        if (!installOne(name)) failed++;
      }
      exit(failed === 0 ? 0 : 1);
    }

    case "update": {
      if (!existsSync(join(INSTALL_DIR, ".git"))) {
        fail("nothing installed yet — run `agent-skills install` first");
      }
      ensureRepo();
      log("done");
      return;
    }

    case "uninstall": {
      const requested = args.slice(1);
      const targets = requested.length > 0 ? requested : listSkills();
      for (const name of targets) uninstallOne(name);
      return;
    }

    default:
      fail(`unknown command: ${cmd}\n\n${HELP}`);
  }
}

main().catch((err) => {
  warn(err.stack || String(err));
  exit(1);
});
