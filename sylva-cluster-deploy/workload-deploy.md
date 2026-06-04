# Workload Cluster Deploy & Repair

Deploy or repair workload clusters using `apply-workload-cluster.sh`.
One script handles both deploy and redeploy.

## Prerequisites

Management cluster must be reachable:
```bash
export KUBECONFIG=~/sylva-core/management-cluster-kubeconfig
oc get nodes
```

## Step 1: Select Workload Type

Ask the user which workload cluster type. Available paths under
`environment-values/workload-clusters/`:

| Path | Description |
|------|-------------|
| `ocp/` | OCP workload cluster |
| `okd/` | OKD workload cluster |
| `okd-capm3/` | OKD on bare metal (capm3) |
| `rke2-capm3/` | RKE2 on bare metal |
| `rke2-capo/` | RKE2 on OpenStack |
| `rke2-capv/` | RKE2 on vSphere |
| `rke2-capd/` | RKE2 on Docker (dev) |
| `kubeadm-capd/` | Kubeadm on Docker (dev) |
| `kubeadm-capo/` | Kubeadm on OpenStack |
| `kubeadm-capm3-virt/` | Kubeadm on virtual bare metal |
| `ck8s-capo/` | CK8s on OpenStack |
| `ck8s-capm3-virt/` | CK8s on virtual bare metal |

List the actual directories:
```bash
ls ~/sylva-core/environment-values/workload-clusters/
```

Store: `WC_TYPE=<chosen type>`

## Step 2: Deploy

```bash
tmux new-session -d -s workload-deployment \
  "cd ~/sylva-core && source bin/env && \
   ./apply-workload-cluster.sh environment-values/workload-clusters/$WC_TYPE 2>&1 | tee workload-deploy.log; exec bash"
```

The workload namespace = basename of the env path (e.g. `ocp`, `okd-capm3`).

## Step 3: Monitor

```bash
export KUBECONFIG=~/sylva-core/management-cluster-kubeconfig
kubectl get kustomizations -n $WC_TYPE --no-headers | awk '$3 != "True"'
kubectl get helmreleases -n $WC_TYPE | grep -v "True"
kubectl get cluster,machine -n $WC_TYPE
```

Watch until all kustomizations are ready.

## Workload Repair

Same script is re-run after fixes. The flow:

1. **Investigate**: check kustomizations, HelmReleases, pods, events in the
   workload namespace (`-n $WC_TYPE`)
2. **Diagnose**:
   ```bash
   kubectl get pods -n $WC_TYPE | grep -v "Running\|Completed\|Succeeded"
   kubectl get events -n $WC_TYPE --sort-by='.lastTimestamp' | grep -i "error\|fail" | tail -20
   ```
3. **Fix** code in `~/sylva-core/`
4. **Commit & Push** — follow the Commit & Push Procedure in SKILL.md
5. **Re-run**:
   ```bash
   tmux kill-session -t workload-deployment 2>/dev/null
   tmux new-session -d -s workload-deployment \
     "cd ~/sylva-core && source bin/env && \
      ./apply-workload-cluster.sh environment-values/workload-clusters/$WC_TYPE 2>&1 | tee workload-deploy.log; exec bash"
   ```
6. **Repeat** until ready

## Key Files

| File | Purpose |
|------|---------|
| `apply-workload-cluster.sh` | Deploy/update workload cluster |
| `environment-values/workload-clusters/<type>/` | Workload env config |
| `charts/sylva-units/values.yaml` | Unit definitions |
| `management-cluster-kubeconfig` | Access to management cluster |

## Key Differences from Management

- No `bootstrap.sh`, no KIND, no pivot
- Applied directly to the running management cluster
- Namespace = workload type basename
- `apply-workload-cluster.sh` is idempotent — safe to re-run
