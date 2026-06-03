---
name: sylva-cluster-deploy
description: >-
  Deploy, repair, and redeploy Sylva OKD management clusters on bare metal (cabpoa/capm3).
  Runs bootstrap.sh or apply.sh, monitors Flux kustomizations, diagnoses failures,
  applies code fixes, commits, and retries until all units are ready.
  Also the final step in the Learn → Suggest → Deploy pipeline for adapting units to OKD.
  Use when the user mentions deploying, repairing, redeploying, or troubleshooting
  a Sylva management cluster, OKD cluster, or pivot issues.
---

# Sylva Cluster Deploy & Repair

## Overview

This skill manages the full lifecycle of a Sylva OKD management cluster:
- **Redeploy**: Tear down existing state and deploy from scratch
- **Repair**: Diagnose failures on a running cluster, apply fixes, and retry

Also serves as the final step in the Learn → Suggest → Deploy pipeline for
adapting units to OKD.

The cluster uses `bootstrap_provider: cabpoa` and `infra_provider: capm3` (bare metal with assisted installer).

## Shared Session Context

Both this agent and the code-validate agent share a session context file at
`~/sylva-core/.agent-session.md`. This is the shared memory between agents.

**At session start** (Step 0), initialize the file with the session header:

```markdown
# Agent Session — <DATE>

## Session Goal
<what the user asked to do — e.g. "Enable metallb unit on OKD management cluster">

## Mode
<Redeploy | Repair | Upgrade>

## Cluster
<cluster name> @ <node IP>
```

**Before each commit**, append a context entry describing the issue and the
approach being taken:

```markdown
### Fix Attempt: <short description>
<DATE_TIME>

- **Problem**: <what failed and how it was diagnosed>
- **Approach**: <what the fix does and why this approach was chosen>
- **Files changed**: <list of files>
```

The code-validate agent reads this before reviewing your commit, and appends
its own review notes (approvals, rejections, contradictions). **Read this file
before each new fix attempt** to recall prior decisions and reviewer feedback.

## Local Environment Files — Never Commit

Changes to local environment files are **local only** — never stage, commit,
or push them. These files contain site-specific configuration (node IPs,
credentials, disk paths) that only apply to this deployment.

**Local env files (never commit):**
- `environment-values/*` (anything under this directory, any environment)
- `*kubeconfig*` (any file with kubeconfig in the name)
- `.env`

When the user asks to enable a unit, disable a unit, change a version, or
modify environment values, **edit the file locally but do not commit it**.
The change takes effect when `apply.sh` runs — it reads the local working tree.

Only commit changes to shared codebase files: `charts/`, `kustomize-units/`,
`tools/`, etc.

## Commit & Push Procedure (used by all steps)

Every time you need to commit and push code changes, follow this procedure
instead of pushing directly. This applies to **all** commit points in the
skill (Upgrade, Repair fix loop, Apply Fix, etc.).

1. **Stage and commit** (do NOT push yet) — stage only the relevant
   codebase files, **never** local env files:

```bash
cd ~/sylva-core
git add charts/ kustomize-units/ tools/
git diff --cached --name-only | grep -E 'environment-values/|kubeconfig|\.env' && echo "ERROR: local env files staged!" && git reset HEAD && exit 1
git commit -m "<descriptive message about the issue and fix>"
```

2. **Call the code-validate sub-agent** using the Task tool:

```
subagent_type: generalPurpose
description: "Validate commit before push"
prompt: |
  Read the skill at /home/abhi/.cursor/skills/code-validate/SKILL.md and follow it.
  Validate the HEAD commit in ~/sylva-core.
  Issue being solved: <paste the issue/problem description here>
  Return CODE_VALIDATE_RESULT with your verdict.
```

3. **Parse the result**:

   - If `CODE_VALIDATE_RESULT: APPROVED` → run `git push`

   - If `CODE_VALIDATE_RESULT: CONTRADICTION` → the change conflicts with a
     previously approved fix. Read `CONFLICTING_COMMITS` and `DETAIL`, then
     choose one of:
     - **Revise**: the contradiction is unintentional → `git reset HEAD~1`,
       fix the code to avoid the conflict, re-commit, and re-submit to the validator.
     - **Justify**: the contradiction is intentional (e.g. the earlier fix was
       wrong, or new evidence shows the revert is needed) → re-submit to the
       validator with the same commit but add `JUSTIFICATION:` to the prompt
       explaining why the contradictory change is necessary:
       ```
       prompt: |
         Read the skill at /home/abhi/.cursor/skills/code-validate/SKILL.md and follow it.
         Validate the HEAD commit in ~/sylva-core.
         Issue being solved: <issue description>
         JUSTIFICATION: <explain why this change intentionally contradicts commit <sha>:
         e.g. "The earlier fix in <sha> added X, but that caused Y. This commit
         reverts X and applies Z instead because...">
         Return CODE_VALIDATE_RESULT with your verdict.
       ```

   - If `CODE_VALIDATE_RESULT: REJECTED` → read the REASON and ACTION,
     fix the commit (`git reset HEAD~1`, re-edit, re-commit), and re-submit
     to the validator.

**Never push without an APPROVED verdict from code-validate.**

## Learn → Suggest → Deploy Pipeline

When enabling a unit that wasn't designed for OKD, use the three-agent chain:

1. **Learn** (`learn-sylva-units`) — investigates the unit across distributions
2. **Suggest** (`suggest-adaptation`) — proposes OKD adaptation paths, user picks one
3. **Deploy** (this skill) — implements the chosen path, commits, validates, pushes

Each agent automatically calls the next. This skill is the final step — it
receives the adaptation decision from `.agent-session.md` and implements it.

## Step 0: Read Environment

Before asking anything, read `environment-values/my-okd-capm3/values.yaml` and extract:
- **Cluster name**: `cluster.name` (e.g. `mgmt`)
- **Node IP**: `cluster.baremetal_hosts.node0.ip_preallocations.primary`
- **Longhorn disk device**: from `units.longhorn-okd-disk-sno.kustomization_spec.postBuild.substitute.LONGHORN_DISK_DEVICE`
- **Longhorn disk path**: from `cluster.baremetal_hosts.node0.longhorn_disk_config[0].path`

Echo to user:
```
Cluster: <name>
Node IP: <ip>
Longhorn disk: <device> → <path>
```

After reading the environment and confirming the mode with the user (Step 1),
**initialize the shared session context** file at `~/sylva-core/.agent-session.md`:

```markdown
# Agent Session — <DATE>

## Session Goal
<what the user asked to do>

## Mode
<Redeploy | Repair>

## Cluster
<cluster name> @ <node IP>
```

If the file already exists from a previous session, append a new session header
rather than overwriting — this preserves history from prior runs.

## Step 1: Ask the User

Present defaults and let the user confirm or override:

### 1a. Mode

```
Repair   — Detect current state, find failures, fix code, commit, retry
Redeploy — Clean teardown + fresh bootstrap.sh from scratch
Learn    — Deep-dive into what a unit does (resources, dependencies, policies, impact)
```

### 1b. Configuration (show defaults, ask if user wants to change)

| Setting | Default | Notes |
|---------|---------|-------|
| SSH user | `core` | OKD/RHCOS default |
| SSH key path | `~/.ssh/ocp_ssh_key` | Other option: `~/.ssh/id_rsa` |
| Node IP | *(from values.yaml)* | Auto-detected |
| BOOTSTRAP_WATCH_TIMEOUT_MIN | `240` | 4 hours |

Ask: "Defaults above OK, or do you want to change any?"

Store for session:
```
CLUSTER_NAME=<from values.yaml>
NODE_SSH_USER=core
NODE_SSH_KEY=~/.ssh/ocp_ssh_key
NODE_IP=<from values.yaml>
WATCH_TIMEOUT=240
```

## Step 2A: Redeploy (from scratch)

### Prerequisites check

```bash
cd ~/sylva-core
source bin/env
```

Verify required tools: `kubectl`, `kind`, `helm`, `yq`, `flux`, `clusterctl`, `sylvactl`.

### Teardown existing cluster

1. **Delete bootstrap KIND cluster** (if exists):
```bash
kind delete cluster --name sylva
```

2. **Wipe longhorn disk** on the BMH node via SSH:

```bash
ssh -i $NODE_SSH_KEY -o StrictHostKeyChecking=no $NODE_SSH_USER@$NODE_IP \
  "sudo wipefs -a <LONGHORN_DISK_DEVICE> && sudo rm -rf <LONGHORN_DISK_PATH> && echo 'disk wiped'"
```

If SSH is unreachable (node already down), skip — the `longhorn-okd-disk-sno` unit handles disk setup.

3. **Remove stale kubeconfig**:
```bash
rm -f ~/sylva-core/management-cluster-kubeconfig
```

### Deploy

Run the deployment in a tmux window so it persists across disconnects:

```bash
tmux new-session -d -s sylva-deployment \
  "cd ~/sylva-core && source bin/env && unset KUBECONFIG && BOOTSTRAP_WATCH_TIMEOUT_MIN=$WATCH_TIMEOUT MGMT_WATCH_TIMEOUT_MIN=$WATCH_TIMEOUT ./bootstrap.sh environment-values/my-okd-capm3 2>&1 | tee bootstrap.log; exec bash"
```

To check on it: `tmux attach -t sylva-deployment`

Follow the active monitoring procedure below while it runs.

## Step 2B: Repair (fix existing cluster)

### Detect current state

```bash
kind get clusters 2>/dev/null | grep sylva
ls -la ~/sylva-core/management-cluster-kubeconfig
export KUBECONFIG=~/sylva-core/management-cluster-kubeconfig && oc get nodes
```

Based on state:
- **KIND exists, no management kubeconfig** → bootstrap is still running or failed pre-pivot
- **KIND exists, management reachable** → pivot may be in progress or failed
- **No KIND, management reachable** → post-pivot, management is running
- **Neither exists** → need full redeploy

Then follow diagnosis (Step 4) and fix loop (Step 5).

## Step 3: Active Monitoring (during deploy)

### Phase tracking

The deployment goes through these phases:
1. **KIND bootstrap** (~2 min)
2. **Flux + sylva-units-operator** (~3 min)
3. **Bootstrap units** (~15 min) — metal3/ironic, MCE, assisted-installer
4. **BMH provisioning + OKD install** (~20-30 min)
5. **Pivot** (~10 min)
6. **Management units** (~20 min)
7. **"Sylva is ready" + "All done"**

### 3a. Monitor OKD cluster install via ACI events

Once the BMH reaches `provisioning` or `provisioned` state, start watching the ACI events:

```bash
# Get the ACI eventsURL
EVENTS_URL=$(kubectl get aci ${CLUSTER_NAME}-control-plane -n sylva-system -o yaml | grep -i eventsURL | cut -d':' -f2-)
curl -k $EVENTS_URL | jq .
```

Poll this every 2-3 minutes. Key events to watch for:
- `"All is well"` → OKD install progressing normally
- Errors about `bootstrap`, `etcd`, `api` → install issues
- Once install completes, the ACI state transitions to `installing` → `installed`

### 3b. Watch kustomization convergence — proactive diagnosis

While `bootstrap.sh` or `apply.sh` is running, periodically check kustomization health:

```bash
# Get all non-ready kustomizations with their age
kubectl get kustomizations.kustomize.toolkit.fluxcd.io -n sylva-system --no-headers | awk '$3 != "True"'
```

**For any kustomization stuck >15 minutes:**

1. Check its status message:
```bash
kubectl get kustomization <name> -n sylva-system -o jsonpath='{.status.conditions[?(@.type=="Ready")].message}'
```

2. If `DependencyNotReady` — trace the dependency:
```bash
# What is it waiting for?
kubectl get kustomization <name> -n sylva-system -o jsonpath='{.spec.dependsOn}'
# Check the blocking dependency's status
kubectl get kustomization <blocking-dep> -n sylva-system
```

3. If `HealthCheckFailed` — check the underlying resource:
```bash
# The message tells you what resource is failing health check
# e.g. "timeout waiting for: [HelmRelease/sylva-system/foo status: 'InProgress']"
kubectl get helmrelease <name> -n sylva-system -o jsonpath='{.status.conditions[0].message}'
# Check pods in the target namespace
kubectl get pods -n <target-namespace> | grep -v Running
```

4. If the root cause is identifiable and a fix is needed:
   - Echo the issue and proposed fix to the user
   - Example: "Kustomization `longhorn` stuck >15m: blocked by `longhorn-okd-disk-sno` which is waiting for MCP reboot. This is expected — MCP reboots take ~15 min on bare metal."
   - Example: "Kustomization `keycloak-init` stuck >15m: SCC violation on kube-job pod. Fix: add namespace to kube-job SCC."

5. **Expected long waits** (do NOT flag these as issues):
   - `cluster` waiting for OACP (OKD install ~20-30 min)
   - `cluster-machines-ready` waiting for machine Ready (follows OACP)
   - `longhorn-okd-disk-sno` / `longhorn` during MCP reboot (~15 min)
   - `pivot` waiting for `management-sylva-units-ready`
   - `capi-providers-pivot-ready` waiting for CAPI providers on management

6. **Unexpected long waits** (flag these):
   - Any HelmRelease in `InstallFailed` or `UpgradeFailed`
   - Pods in `CrashLoopBackOff`, `ImagePullBackOff`, `Error`
   - SCC violations (`FailedCreate` events)
   - Dependency loops (A waits for B, B waits for A)

## Step 4: Diagnosis Flow

### 4.1 Check Flux kustomizations

```bash
flux get kustomizations -n sylva-system | grep -v "True"
```

### 4.2 Check failing HelmReleases

```bash
flux get helmreleases -n sylva-system | grep -v "True"
```

For each failing HR:
```bash
oc describe helmrelease <name> -n sylva-system | tail -30
```

### 4.3 Check pods

```bash
oc get pods -A | grep -v "Running\|Completed\|Succeeded" | grep -v "NAMESPACE"
```

### 4.4 Check events

```bash
oc get events -A --sort-by='.lastTimestamp' | grep -i "error\|fail\|warning" | tail -20
```

### 4.5 Check CAPI objects (if pivot-related)

```bash
oc get cluster,machine,bmh,metal3machine -n sylva-system
oc get openshiftassistedcontrolplane -n sylva-system
```

### 4.6 Check SCC issues (OKD-specific)

```bash
oc get events -A --field-selector reason=FailedCreate | grep -i "scc\|security"
```

## Step 5: Apply Fix

1. Identify the root cause from diagnosis
2. Check [known-issues.md](known-issues.md) for previously encountered issues
3. Make the code change in `~/sylva-core/`
4. **Commit and validate** — follow the [Commit & Push Procedure](#commit--push-procedure-used-by-all-steps) (stage, commit, call code-validate sub-agent, push only after APPROVED).
5. Re-run the appropriate script:
   - Pre-pivot issue:
     ```bash
     tmux new-session -d -s sylva-deployment \
       "cd ~/sylva-core && source bin/env && unset KUBECONFIG && BOOTSTRAP_WATCH_TIMEOUT_MIN=$WATCH_TIMEOUT MGMT_WATCH_TIMEOUT_MIN=$WATCH_TIMEOUT ./bootstrap.sh environment-values/my-okd-capm3 2>&1 | tee bootstrap.log; exec bash"
     ```
   - Post-pivot issue:
     ```bash
     tmux new-session -d -s sylva-deployment \
       "cd ~/sylva-core && source bin/env && unset KUBECONFIG && APPLY_WATCH_TIMEOUT_MIN=$WATCH_TIMEOUT ./apply.sh environment-values/my-okd-capm3 2>&1 | tee apply.log; exec bash"
     ```

## Step 6: Retry Loop

After applying a fix and re-running:
1. Resume active monitoring (Step 3)
2. If a new failure appears, go back to Step 4
3. Continue until `display_final_messages` prints "All done"

## Key Files

| File | Purpose |
|------|---------|
| `bootstrap.sh` | Full deploy: KIND → bootstrap → pivot → management |
| `apply.sh` | Update/retry on existing management cluster |
| `charts/sylva-units/scripts/pivot.sh` | Pivot logic (clusterctl move, cabpoa patches) |
| `charts/sylva-units/values.yaml` | Unit definitions, dependencies, default values |
| `charts/sylva-units/bootstrap.values.yaml` | Bootstrap-only value overrides |
| `charts/sylva-units/management.values.yaml` | Management-only value overrides |
| `environment-values/my-okd-capm3/` | Environment config (IPs, BMH, secrets) |
| `kustomize-units/openshift-security-context-constraints/` | OKD SCC definitions |
| `tools/shell-lib/common.sh` | Shared shell functions |

## Environment Details

- **Env path**: `environment-values/my-okd-capm3`
- **Bootstrap provider**: `cabpoa` (Cluster API Bootstrap Provider OpenShift Assisted)
- **Infra provider**: `capm3` (Cluster API Provider Metal3)
- **OKD version**: Read from `environment-values/my-okd-capm3/values.yaml` → `cluster.openshift.version`
- **Single Node OpenShift (SNO)**: `control_plane_replicas: 1`
- **BMH**: One bare metal host (`mgmt-node0`) with virtual BMC (sushy-emulator)
- **Management kubeconfig**: `~/sylva-core/management-cluster-kubeconfig`
- **Bootstrap kubeconfig**: `~/.kube/config` (KIND context `kind-sylva`)

## Additional Resources

- For a catalog of known issues and their fixes, see [known-issues.md](known-issues.md)
- Health check script: [scripts/check-cluster-health.sh](scripts/check-cluster-health.sh)
