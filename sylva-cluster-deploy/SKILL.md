---
name: sylva-cluster-deploy
description: >-
  Deploy, repair, upgrade, and redeploy Sylva OKD management clusters on bare metal (cabpoa/capm3).
  Runs bootstrap.sh or apply.sh, monitors Flux kustomizations, diagnoses failures,
  applies code fixes, commits, and retries until all units are ready.
  Use when the user mentions deploying, repairing, redeploying, upgrading,
  enabling/disabling units, version upgrades, or troubleshooting
  a Sylva management cluster, OKD cluster, or pivot issues.
---

# Sylva Cluster Deploy, Apply & Repair

## Overview

This skill manages the full lifecycle of a Sylva OKD management cluster:
- **Redeploy**: Tear down existing state and deploy from scratch (`bootstrap.sh`)
- **Upgrade**: Push changes to an already-deployed cluster (`apply.sh`) — enable/disable units, upgrade versions, change config
- **Repair**: Diagnose failures on a running cluster, apply fixes, and retry

The cluster uses `bootstrap_provider: cabpoa` and `infra_provider: capm3` (bare metal with assisted installer).

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

## Step 1: Ask the User

Present defaults and let the user confirm or override:

### 1a. Mode

```
Upgrade  — Push changes to a running cluster (enable/disable units, version upgrades, config changes)
Repair   — Detect current state, find failures, fix code, commit, retry
Redeploy — Clean teardown + fresh bootstrap.sh from scratch
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

## Step 2C: Upgrade (update existing cluster)

Use `apply.sh` whenever the management cluster is already deployed and you need to make changes:
- Enable or disable units (edit `environment-values/my-okd-capm3/values.yaml`)
- Upgrade OKD or chart versions
- Change configuration values (replicas, timeouts, feature flags, etc.)
- Add new source_templates or registry mirrors

### Workflow

1. **Verify the cluster is reachable**:
```bash
export KUBECONFIG=~/sylva-core/management-cluster-kubeconfig
oc get nodes
```

2. **Edit the local environment values file** directly — `environment-values/my-okd-capm3/values.yaml`.

   Common examples:
   - **Enable a unit**: set `units.<unit-name>.enabled: true` (or remove the `enabled: false` line)
   - **Disable a unit**: set `units.<unit-name>.enabled: false`
   - **Upgrade OKD version**: update `cluster.openshift.version`
   - **Change chart version**: update the relevant `source_templates` tag
   - **Tune values**: modify `units.<unit-name>.helmrelease_spec.values` or `kustomization_spec.postBuild.substitute`

3. **Commit and push**:
```bash
cd ~/sylva-core
git add -A
git commit -m "<descriptive message>"
git push
```

4. **Run apply.sh** in a tmux session:
```bash
tmux kill-session -t sylva-deployment 2>/dev/null
tmux new-session -d -s sylva-deployment \
  "cd ~/sylva-core && source bin/env && unset KUBECONFIG && APPLY_WATCH_TIMEOUT_MIN=$WATCH_TIMEOUT ./apply.sh environment-values/my-okd-capm3 2>&1 | tee apply.log; exec bash"
```

5. Follow active monitoring (Step 3) — `apply.sh` uses the same `sylvactl watch` mechanism.

### What apply.sh does

- Detects `management-cluster-kubeconfig` and uses it automatically
- Ensures Flux and sylva-units-operator are running
- Applies the updated SylvaUnitsRelease to the cluster
- Watches kustomizations until `sylva-units-status` is ready
- Default timeout: `APPLY_WATCH_TIMEOUT_MIN=20` (shorter than bootstrap since only changed units reconcile)

### Failure loop for newly enabled units

When enabling a new unit, `apply.sh` will often fail on the first attempt. Follow this loop:

1. **Monitor apply.sh** — watch for kustomization/HelmRelease failures on the newly enabled unit.

2. **Diagnose the failure** — common root causes for new units on OKD:
   - **SCC (SecurityContextConstraints)** — pods fail with `FailedCreate` due to missing SCC permissions. Check:
     ```bash
     oc get events -A --field-selector reason=FailedCreate | grep -i "scc\|security"
     oc get pods -A | grep -v "Running\|Completed\|Succeeded" | head -20
     ```
   - **Missing CRDs** — the unit depends on a CRD not yet installed
   - **Image pull errors** — registry mirror missing or image tag wrong
   - **Resource conflicts** — namespace or resource name collisions
   - **Dependency issues** — unit depends on another unit that isn't enabled

3. **Kill the stuck apply.sh**:
   ```bash
   tmux kill-session -t sylva-deployment
   ```

4. **Fix the root cause** in the codebase (e.g. add SCC, fix chart values, add dependency).

5. **Commit and push the fix**:
   ```bash
   cd ~/sylva-core
   git add -A
   git commit -m "<fix description>"
   git push
   ```

6. **Re-run apply.sh**:
   ```bash
   tmux new-session -d -s sylva-deployment \
     "cd ~/sylva-core && source bin/env && unset KUBECONFIG && APPLY_WATCH_TIMEOUT_MIN=$WATCH_TIMEOUT ./apply.sh environment-values/my-okd-capm3 2>&1 | tee apply.log; exec bash"
   ```

7. **Repeat** until `apply.sh` prints "All done".

### Notes

- `apply.sh` is idempotent — safe to re-run after killing and fixing
- Only changed units reconcile; unchanged units stay as-is
- The diagnosis flow (Step 4) and fix flow (Step 5) also apply here

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
4. Commit locally:
```bash
cd ~/sylva-core
git add -A
git commit -m "<descriptive message>"
```
5. **Ask the user before pushing**: "Fix committed locally. Push to origin?"
6. Re-run the appropriate script:
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
| `apply.sh` | Apply changes to existing cluster (enable/disable units, upgrades, config) |
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
