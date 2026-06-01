---
name: sylva-cluster-deploy
description: >-
  Deploy, repair, and redeploy Sylva OKD management clusters on bare metal (cabpoa/capm3).
  Runs bootstrap.sh or apply.sh, monitors Flux kustomizations, diagnoses failures,
  applies code fixes, commits, and retries until all units are ready.
  Use when the user mentions deploying, repairing, redeploying, or troubleshooting
  a Sylva management cluster, OKD cluster, or pivot issues.
---

# Sylva Cluster Deploy & Repair

## Overview

This skill manages the full lifecycle of a Sylva OKD management cluster:
- **Redeploy**: Tear down existing state and deploy from scratch
- **Repair**: Diagnose failures on a running cluster, apply fixes, and retry

The cluster uses `bootstrap_provider: cabpoa` and `infra_provider: capm3` (bare metal with assisted installer).

## Step 1: Ask the User

Before doing anything, ask whether this is a **Repair** or **Redeploy**:

```
Repair  — Detect current state, find failures, fix code, commit, retry
Redeploy — Clean teardown + fresh bootstrap.sh from scratch
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

2. **Wipe longhorn disk** on the BMH node (if management cluster is reachable):
```bash
export KUBECONFIG=~/sylva-core/management-cluster-kubeconfig
# Get the node name
NODE=$(oc get nodes -o jsonpath='{.items[0].metadata.name}')
# The disk path comes from environment-values — read it:
```
Read `environment-values/my-okd-capm3/values.yaml` for the `longhorn_disk_config[].path` and `LONGHORN_DISK_DEVICE` values.

3. **Remove stale kubeconfig**:
```bash
rm -f ~/sylva-core/management-cluster-kubeconfig
```

### Deploy

```bash
cd ~/sylva-core
./bootstrap.sh environment-values/my-okd-capm3
```

This runs for ~45-90 minutes. Background the command and monitor it.

### Monitor deployment

The deployment goes through these phases:
1. **KIND bootstrap** (~2 min) — creates local KIND cluster
2. **Flux + sylva-units-operator install** (~3 min)
3. **Bootstrap units** (~15 min) — metal3/ironic, MCE, assisted-installer, os-image-server
4. **BMH provisioning** (~20 min) — node inspection, ISO boot, OKD install
5. **Pivot** (~10 min) — `clusterctl move` from KIND → management
6. **Management units** (~20 min) — keycloak, vault, longhorn, crossplane, etc.
7. **`display_final_messages`** — prints "Sylva is ready" and "All done"

While running, periodically check status. See `scripts/check-cluster-health.sh` for the health check procedure.

**When the deploy fails** (the script exits non-zero or a kustomization is stuck):
1. Run the health check to identify the failure
2. Follow the diagnosis flow in Step 3
3. Apply the fix, commit
4. If bootstrap failed → re-run `./bootstrap.sh environment-values/my-okd-capm3`
5. If post-pivot management failed → run `./apply.sh environment-values/my-okd-capm3`
6. Repeat until "All done"

## Step 2B: Repair (fix existing cluster)

### Detect current state

Determine what exists:

```bash
# Bootstrap KIND cluster?
kind get clusters 2>/dev/null | grep sylva

# Management kubeconfig available?
ls -la ~/sylva-core/management-cluster-kubeconfig

# Management cluster reachable?
export KUBECONFIG=~/sylva-core/management-cluster-kubeconfig
oc get nodes
```

Based on state:
- **KIND exists, no management kubeconfig** → bootstrap is still running or failed pre-pivot
- **KIND exists, management reachable** → pivot may be in progress or failed
- **No KIND, management reachable** → post-pivot, management is running
- **Neither exists** → need full redeploy

### Check for failures

Run the health check script, then follow diagnosis (Step 3).

## Step 3: Diagnosis Flow

### 3.1 Check Flux kustomizations

```bash
# On whichever cluster is relevant (bootstrap or management)
flux get kustomizations -n sylva-system | grep -v "True"
```

Look for `False` or `Unknown` status. Common patterns:
- **Health check timeout** → a downstream resource is stuck
- **Reconciliation in progress** → still converging (wait 2-3 min, recheck)
- **dependency ... is not ready** → upstream unit is blocking

### 3.2 Check failing HelmReleases

```bash
flux get helmreleases -n sylva-system | grep -v "True"
```

For each failing HR:
```bash
oc describe helmrelease <name> -n sylva-system | tail -30
```

### 3.3 Check pods

```bash
oc get pods -A | grep -v "Running\|Completed\|Succeeded" | grep -v "NAMESPACE"
```

For failing pods:
```bash
oc describe pod <pod> -n <ns> | tail -30
oc logs <pod> -n <ns> --tail=50
```

### 3.4 Check events

```bash
oc get events -A --sort-by='.lastTimestamp' | grep -i "error\|fail\|warning" | tail -20
```

### 3.5 Check CAPI objects (if pivot-related)

```bash
oc get cluster,machine,bmh,metal3machine -n sylva-system
oc get openshiftassistedcontrolplane -n sylva-system
```

### 3.6 Check SCC issues (OKD-specific)

```bash
oc get events -A --field-selector reason=FailedCreate | grep -i "scc\|security"
```

## Step 4: Apply Fix

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
   - Pre-pivot issue → `./bootstrap.sh environment-values/my-okd-capm3`
   - Post-pivot issue → `./apply.sh environment-values/my-okd-capm3`

## Step 5: Retry Loop

After applying a fix and re-running:
1. Monitor the deployment (background the script)
2. Periodically run health checks
3. If a new failure appears, go back to Step 3
4. Continue until `display_final_messages` prints "All done"

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
