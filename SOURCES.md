# Vendored skill provenance

Skills below are vendored (copied) from upstream repos because OpenClaw's
`skills install git:` only accepts a repo with `SKILL.md` at the root — it
cannot target a subdirectory of a monorepo. To update one, re-copy its
subdirectory from the upstream at a newer commit and bump the pin here.

| Skill | Upstream | Subpath | Pinned commit | License |
|---|---|---|---|---|
| mcp-builder | anthropics/skills | skills/mcp-builder | da20c92 | see skill's LICENSE.txt |
| test-driven-development | obra/superpowers | skills/test-driven-development | 6fd4507 | repo LICENSE |
| receiving-code-review | obra/superpowers | skills/receiving-code-review | 6fd4507 | repo LICENSE |
| requesting-code-review | obra/superpowers | skills/requesting-code-review | 6fd4507 | repo LICENSE |
| karpathy-guidelines | multica-ai/andrej-karpathy-skills | skills/karpathy-guidelines | 2c60614 | MIT |
| pulumi-best-practices | pulumi/agent-skills | pulumi/skills/pulumi-best-practices | 8dccc43 | repo LICENSE |
| pulumi-component | pulumi/agent-skills | pulumi/skills/pulumi-component | 8dccc43 | repo LICENSE |
| pulumi-esc | pulumi/agent-skills | pulumi/skills/pulumi-esc | 8dccc43 | repo LICENSE |
| pulumi-automation-api | pulumi/agent-skills | pulumi/skills/pulumi-automation-api | 8dccc43 | repo LICENSE |
| package-usage | pulumi/agent-skills | pulumi/skills/package-usage | 8dccc43 | repo LICENSE |
| provider-upgrade | pulumi/agent-skills | pulumi/skills/provider-upgrade | 8dccc43 | repo LICENSE |
| pulumi-arm-to-pulumi | pulumi/agent-skills | migration/skills/pulumi-arm-to-pulumi | 8dccc43 | repo LICENSE |
| pulumi-cdk-to-pulumi | pulumi/agent-skills | migration/skills/pulumi-cdk-to-pulumi | 8dccc43 | repo LICENSE |
| pulumi-terraform-to-pulumi | pulumi/agent-skills | migration/skills/pulumi-terraform-to-pulumi | 8dccc43 | repo LICENSE |
| cloudformation-to-pulumi | pulumi/agent-skills | migration/skills/cloudformation-to-pulumi | 8dccc43 | repo LICENSE |
| pulumi-upgrade-provider | pulumi/agent-skills | package-maintenance/skills/pulumi-upgrade-provider | 8dccc43 | repo LICENSE |
| upstream-patches | pulumi/agent-skills | package-maintenance/skills/upstream-patches | 8dccc43 | repo LICENSE |
