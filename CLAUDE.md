## Execution Policy (High Autonomy, Safe Boundaries)

Act autonomously for normal development work. Do not ask for confirmation for routine, reversible actions.

### Run Without Asking
- Read/search operations (`ls`, `find`, `grep`, file reads, symbol/code search).
- Non-destructive shell checks (`which`, `--version`, `git status`, `git diff`, `pwd`, env reads).
- Local builds/tests/lints/typechecks.
- File edits needed to complete the task.
- Re-running failed commands after a straightforward fix.

### Ask Only For These Cases
- Destructive or irreversible actions (deletes, resets, force operations, history rewrites).
- Networked actions with side effects (deploys, publishing, creating external resources).
- Security/billing/production-impacting changes.
- Access to secrets/credentials not already available.
- Ambiguity that materially changes implementation outcome.

### Tool Behavior
- Batch related checks into as few commands as practical.
- Prefer read-only inspection before editing.
- Prefer non-destructive commands and explain tradeoffs briefly after execution.
- If blocked by permission policy, propose the minimal safe command alternative.

### Git Safety
- Never force-push or rewrite published history unless explicitly requested.
- Never commit unless explicitly asked.
- Do not revert user changes you did not introduce.

### Response Style
- Be concise and direct.
- Explain what changed and why.
- Suggest next validation step only when useful.

## Tooling & Environment

- My system packages are declared in ~/nix-config. Check there before
  reaching for web-based alternatives or assuming a tool isn't available.
- When a CLI tool exists for a platform (glab, gh, jira, etc.), use it
  instead of WebFetch/curl.
- Prefer MCP tools over Bash CLI when an MCP server is connected
  (e.g., use GitLab/GitHub/Kubernetes MCP tools instead of shelling out
  to glab/gh/kubectl). Fall back to CLI only when MCP doesn't cover the
  operation.
- AWS: I use aws-vault for credential management. There is no AWS MCP —
  use `aws-vault exec <profile> -- aws ...` via Bash when needed.
- If a needed tool isn't system-installed:
  - One-off use: `nix shell nixpkgs#<pkg> --command <cmd>`
  - Recurring use in a project: add it to the project's `flake.nix`
    devShell (I have direnv + nix-direnv, so it activates automatically)
- If a project has no `flake.nix`, create one with a devShell — but
  never commit it yourself, let me review and commit.

## Research & Documentation

- When I share a link, read it directly (WebFetch/Read) before doing
  any web searches. The answer is usually in the linked doc.
- Do not guess CLI flags or commands — check `--help` or docs first.

## Karpathy Guidelines

Behavioral principles to reduce common LLM coding mistakes (from
[Andrej Karpathy](https://x.com/karpathy/status/2015883857489522876),
MIT-licensed). Bias toward caution over speed; for trivial tasks, use
judgment.

### 1. Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop, name what's confusing, ask.

### 2. Simplicity First
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.

### 3. Surgical Changes
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions that *your* changes made unused;
  leave pre-existing dead code alone unless asked.
- Every changed line should trace directly to the request.

### 4. Goal-Driven Execution
- Define verifiable success criteria before implementing.
- Prefer test-backed verification when tests exist or are easy to add:
  - "Add validation" → write tests for invalid inputs, then make them pass.
  - "Fix the bug" → write a test that reproduces it, then make it pass.
  - "Refactor X" → ensure tests pass before and after.
- For multi-step tasks, state a brief plan with a verify step per item:
  `1. [step] → verify: [check]`.
