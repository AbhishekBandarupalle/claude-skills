---
name: sylva-cluster-deploy
description: >-
  Deploy, repair Sylva management clusters and workload clusters on bare metal.
  Also the final step in the Learn → Suggest → Deploy pipeline.
  Use when deploying, repairing, redeploying, or troubleshooting
  a Sylva management cluster, workload cluster, OKD cluster, or pivot issues.
---

# Sylva Cluster Deploy & Repair

## Modes

| Mode | Trigger | What to read |
|------|---------|--------------|
| Management Redeploy | "redeploy", "from scratch" | [mgmt-redeploy.md](mgmt-redeploy.md) |
| Management Repair | "fix", "stuck", "failing" | [mgmt-repair.md](mgmt-repair.md) |
| Workload Deploy | "deploy workload", "workload cluster" | [workload-deploy.md](workload-deploy.md) |
| Workload Repair | "fix workload", "workload failing" | [workload-deploy.md](workload-deploy.md) |
| Pipeline (from learn-and-suggest) | adaptation decision in `.agent-session.md` | This file only |

After determining the mode, **read only the relevant reference file** — do not
load files for other modes.

## Shared Session Context

Agents share `~/sylva-core/.agent-session.md`. Use compact format:

**Session init** (Step 0):
```
# Session: <goal> | <mode> | <cluster>@<ip>
```

**Before each commit**:
```
## Fix: <short description>
problem: <one line>
approach: <one line>
files: <comma-separated list>
```

**Read this file before each fix attempt** for prior decisions and validator feedback.

## Local Environment Files — Never Commit

**Never stage, commit, or push:**
- `environment-values/*`
- `*kubeconfig*`
- `.env`

Edit locally only. Changes take effect when `apply.sh` / `apply-workload-cluster.sh` runs.
Only commit: `charts/`, `kustomize-units/`, `tools/`.

## Commit & Push Procedure

1. **Stage and commit** (no push):

```bash
cd ~/sylva-core
git add charts/ kustomize-units/ tools/
git diff --cached --name-only | grep -E 'environment-values/|kubeconfig|\.env' && echo "ERROR: local env files staged!" && git reset HEAD && exit 1
git commit -m "<descriptive message>"
```

2. **Call code-validate**:

```
subagent_type: generalPurpose
description: "Validate commit before push"
prompt: |
  Read the skill at /home/abhi/.cursor/skills/code-validate/SKILL.md and follow it.
  Validate the HEAD commit in ~/sylva-core.
  Issue being solved: <issue description>
  Return CODE_VALIDATE_RESULT with your verdict.
```

3. **Parse result**:
   - `APPROVED` → `git push`
   - `CONTRADICTION` → read CONFLICTING_COMMITS and DETAIL. Either:
     - **Revise**: `git reset HEAD~1`, fix, re-commit, re-submit
     - **Justify**: re-submit with `JUSTIFICATION:` in prompt
   - `REJECTED` → `git reset HEAD~1`, fix, re-commit, re-submit

**Never push without APPROVED.**

## Pipeline: Learn → Suggest → Deploy

When called from `learn-and-suggest`, the adaptation decision is in
`.agent-session.md`. Read it, implement the changes, follow the Commit &
Push Procedure, then run the appropriate deploy script.

## Step 0: Read Environment

Read `environment-values/my-okd-capm3/values.yaml` and extract:
- **Cluster name**: `cluster.name`
- **Node IP**: `cluster.baremetal_hosts.node0.ip_preallocations.primary`
- **Longhorn disk**: device + path

Echo: `Cluster: <name> | Node: <ip> | Disk: <device> → <path>`

Init session: `# Session: <goal> | <mode> | <cluster>@<ip>`

## Step 1: Ask the User

```
Management Repair   — fix failures on management cluster
Management Redeploy — teardown + bootstrap.sh from scratch
Workload Deploy     — deploy workload cluster via apply-workload-cluster.sh
Workload Repair     — investigate workload failure, fix, push, redeploy
```

Configuration defaults:

| Setting | Default |
|---------|---------|
| SSH user | `core` |
| SSH key | `~/.ssh/ocp_ssh_key` |
| Node IP | from values.yaml |
| WATCH_TIMEOUT | `240` |

After mode selection, **read the corresponding reference file** and follow it.
