---
name: sylva
description: >-
  Unified entry point for all Sylva agent operations. Parses /sylva commands
  and routes to the right skill. Use when the user says /sylva or mentions
  sylva learn, sylva enable, sylva disable, sylva deploy, sylva troubleshoot,
  sylva repair, sylva redeploy.
---

# Sylva Command Dispatcher

Unified entry point. Parse the user's `/sylva` command and route to the
correct skill/agent.

## Environment Detection

Before routing, detect cluster environment paths. Check shell env vars first,
fall back to defaults:

```bash
echo "SYLVA_MGMT_ENV=${SYLVA_MGMT_ENV:-}"
echo "SYLVA_WC_ENV=${SYLVA_WC_ENV:-}"
```

| Variable | Purpose | Default |
|----------|---------|---------|
| `SYLVA_MGMT_ENV` | Management cluster env values path | `environment-values/my-okd-capm3` |
| `SYLVA_WC_ENV` | Workload cluster env values path | auto-detect from command |

If the user specifies a cluster type in the command (e.g. "ocp", "okd",
"rke2-capm3"), use `environment-values/workload-clusters/<type>` directly.

If no env var is set and no type specified, list available options:
```bash
ls ~/sylva-core/environment-values/workload-clusters/
```

## Command Routing

Parse the `/sylva` command and route:

### Learn commands → `learn-and-suggest` (learn-only mode)

| Command pattern | Action |
|----------------|--------|
| `/sylva learn about <unit>` | Investigate unit, return summary |
| `/sylva what does <unit> do` | Same as learn |
| `/sylva explain <unit>` | Same as learn |
| `/sylva what depends on <unit>` | Dependency lookup from cache |
| `/sylva update learnings` | Re-run all cached investigations |
| `/sylva refresh <unit>` | Re-run investigation for one unit |

Route:
```
Read the skill at ~/claude-skills/learn-and-suggest/SKILL.md and follow it.
Mode: learn-only
Unit: <unit name>
Working directory: ~/sylva-core
```

### Enable/adapt commands → `learn-and-suggest` (full pipeline mode)

| Command pattern | Action |
|----------------|--------|
| `/sylva enable <unit> on management cluster` | Learn + Suggest + Deploy for mgmt |
| `/sylva enable <unit> on workload cluster` | Learn + Suggest + Deploy for workload |
| `/sylva adapt <unit> to OKD` | Same as enable |
| `/sylva disable <unit> on management cluster` | Edit env values locally (no commit) |
| `/sylva disable <unit> on workload cluster` | Edit workload env values locally |

For **enable/adapt**: route to learn-and-suggest in full pipeline mode.
Pass the target cluster type so the deploy agent knows which mode file to use.

```
Read the skill at ~/claude-skills/learn-and-suggest/SKILL.md and follow it.
Mode: learn-suggest-deploy
Unit: <unit name>
Target: <management | workload>
Workload type: <type if workload, from command or SYLVA_WC_ENV>
Management env: <SYLVA_MGMT_ENV or default>
Working directory: ~/sylva-core
```

For **disable**: edit the env values file directly — no pipeline needed.
- Management: edit `$SYLVA_MGMT_ENV/values.yaml`, set `units.<unit>.enabled: false`
- Workload: edit `environment-values/workload-clusters/<type>/values.yaml`
- Do NOT commit (local env files rule).

### Deploy commands → `sylva-cluster-deploy`

| Command pattern | Action |
|----------------|--------|
| `/sylva deploy management cluster` | Redeploy management |
| `/sylva redeploy management` | Same |
| `/sylva deploy <type> workload cluster` | Deploy workload |
| `/sylva deploy ocp workload cluster` | Deploy OCP workload |
| `/sylva deploy okd workload cluster` | Deploy OKD workload |

Route:
```
Read the skill at ~/claude-skills/sylva-cluster-deploy/SKILL.md and follow it.
Mode: <Management Redeploy | Workload Deploy>
Management env: <SYLVA_MGMT_ENV or default>
Workload env: environment-values/workload-clusters/<type>
Working directory: ~/sylva-core
```

### Troubleshoot/repair commands → `sylva-cluster-deploy`

| Command pattern | Action |
|----------------|--------|
| `/sylva troubleshoot management cluster` | Repair management |
| `/sylva repair management cluster` | Same |
| `/sylva fix management cluster` | Same |
| `/sylva troubleshoot workload cluster` | Repair workload |
| `/sylva troubleshoot workload cluster - <error>` | Repair workload with error context |

Route:
```
Read the skill at ~/claude-skills/sylva-cluster-deploy/SKILL.md and follow it.
Mode: <Management Repair | Workload Repair>
Management env: <SYLVA_MGMT_ENV or default>
Workload env: <SYLVA_WC_ENV or from command>
Error context: <error message if provided>
Working directory: ~/sylva-core
```

## Cache Update Rule

**Always update `~/claude-skills/unit-cache.json` whenever the user asks
about units** — whether it's a dependency lookup, a learn command, an
enable/disable, or any conversation that reveals new unit information
(e.g. OKD adaptation patterns, env values overrides, live state findings).

Update the relevant unit entries and `_dependency_graph` section. Include
any new data discovered during the conversation (adaptation patterns,
distribution-specific overrides, blockers, etc.).

## Routing as Parent vs Sub-agent

For simple operations (disable, dependency lookups), handle directly — no
sub-agent needed.

For everything else, launch the appropriate skill as a sub-agent via the
Task tool. Pass all detected env paths and context in the prompt.

## Unknown Commands

If the command doesn't match any pattern, echo the available commands:

```
Available /sylva commands:
  /sylva learn about <unit>          — investigate what a unit does
  /sylva enable <unit> on <cluster>  — adapt and enable a unit
  /sylva disable <unit> on <cluster> — disable a unit locally
  /sylva deploy <type> workload      — deploy a workload cluster
  /sylva deploy management           — redeploy management cluster
  /sylva troubleshoot <cluster>      — diagnose and fix failures
  /sylva refresh <unit>              — re-investigate a cached unit
```
