#!/usr/bin/env bash
# install.sh — symlink skills into ~/.agents/skills/ (and ~/.claude/skills/ if present).
#
# Usage:
#   install.sh                       # install every skill at the repo root
#   install.sh <name> [<name>...]    # install only the named skills
#   install.sh --uninstall           # remove all skill symlinks created from this repo
#   install.sh --uninstall <name>    # remove one
#   install.sh --list                # list skills in this repo
#   install.sh -h | --help           # this help

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS_DIR="${HOME}/.agents/skills"
CLAUDE_DIR="${HOME}/.claude/skills"

usage() {
    sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

list_skills() {
    find "$REPO_DIR" -mindepth 1 -maxdepth 1 -type d \
        ! -name '.*' \
        -exec test -f '{}/SKILL.md' \; \
        -print | xargs -I{} basename {} | sort
}

install_one() {
    local name="$1"
    local src="${REPO_DIR}/${name}"

    if [[ ! -f "${src}/SKILL.md" ]]; then
        echo "skip: ${name} (no SKILL.md found at ${src})" >&2
        return 1
    fi

    mkdir -p "$AGENTS_DIR"
    if [[ -L "${AGENTS_DIR}/${name}" ]]; then
        rm "${AGENTS_DIR}/${name}"
    elif [[ -e "${AGENTS_DIR}/${name}" ]]; then
        echo "error: ${AGENTS_DIR}/${name} exists and is not a symlink. Refusing to overwrite." >&2
        return 1
    fi
    ln -s "$src" "${AGENTS_DIR}/${name}"
    echo "linked: ${AGENTS_DIR}/${name} -> ${src}"

    if [[ -d "$CLAUDE_DIR" ]]; then
        if [[ -L "${CLAUDE_DIR}/${name}" ]]; then
            rm "${CLAUDE_DIR}/${name}"
        elif [[ -e "${CLAUDE_DIR}/${name}" ]]; then
            echo "warn: ${CLAUDE_DIR}/${name} exists and is not a symlink. Skipping ~/.claude/skills mirror." >&2
            return 0
        fi
        ln -s "$src" "${CLAUDE_DIR}/${name}"
        echo "linked: ${CLAUDE_DIR}/${name} -> ${src}"
    fi
}

uninstall_one() {
    local name="$1"
    for base in "$AGENTS_DIR" "$CLAUDE_DIR"; do
        local link="${base}/${name}"
        if [[ -L "$link" ]]; then
            local target
            target="$(readlink "$link")"
            if [[ "$target" == "${REPO_DIR}/"* || "$target" == "${REPO_DIR}" ]]; then
                rm "$link"
                echo "removed: $link"
            else
                echo "skip: $link points outside this repo (-> $target)"
            fi
        fi
    done
}

main() {
    local mode="install"
    local -a targets=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) usage 0 ;;
            --list) list_skills; exit 0 ;;
            --uninstall) mode="uninstall"; shift ;;
            --) shift; targets+=("$@"); break ;;
            -*) echo "unknown flag: $1" >&2; usage 1 ;;
            *) targets+=("$1"); shift ;;
        esac
    done

    if [[ ${#targets[@]} -eq 0 ]]; then
        mapfile -t targets < <(list_skills)
    fi

    if [[ ${#targets[@]} -eq 0 ]]; then
        echo "no skills found at ${REPO_DIR}" >&2
        exit 1
    fi

    local rc=0
    for name in "${targets[@]}"; do
        if [[ "$mode" == "install" ]]; then
            install_one "$name" || rc=$?
        else
            uninstall_one "$name" || rc=$?
        fi
    done
    exit "$rc"
}

main "$@"
