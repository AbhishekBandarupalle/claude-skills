# Management Redeploy

Teardown existing state and deploy from scratch using `bootstrap.sh`.

## Prerequisites

```bash
cd ~/sylva-core && source bin/env
```

Verify: `kubectl`, `kind`, `helm`, `yq`, `flux`, `clusterctl`, `sylvactl`.

## Teardown

1. Delete KIND cluster:
```bash
kind delete cluster --name sylva
```

2. Wipe longhorn disk via SSH:
```bash
ssh -i $NODE_SSH_KEY -o StrictHostKeyChecking=no $NODE_SSH_USER@$NODE_IP \
  "sudo wipefs -a <LONGHORN_DISK_DEVICE> && sudo rm -rf <LONGHORN_DISK_PATH> && echo 'disk wiped'"
```
Skip if SSH unreachable — `longhorn-okd-disk-sno` handles disk setup.

3. Remove stale kubeconfig:
```bash
rm -f ~/sylva-core/management-cluster-kubeconfig
```

## Deploy

```bash
tmux new-session -d -s sylva-deployment \
  "cd ~/sylva-core && source bin/env && unset KUBECONFIG && BOOTSTRAP_WATCH_TIMEOUT_MIN=$WATCH_TIMEOUT MGMT_WATCH_TIMEOUT_MIN=$WATCH_TIMEOUT ./bootstrap.sh environment-values/my-okd-capm3 2>&1 | tee bootstrap.log; exec bash"
```

After starting, follow monitoring in [mgmt-repair.md](mgmt-repair.md) Step 3.

## Key Files

| File | Purpose |
|------|---------|
| `bootstrap.sh` | Full deploy: KIND → bootstrap → pivot → management |
| `charts/sylva-units/scripts/pivot.sh` | Pivot logic |
| `environment-values/my-okd-capm3/` | Environment config |

## Environment

- Bootstrap provider: `cabpoa`, Infra provider: `capm3`
- SNO: `control_plane_replicas: 1`
- BMH: `mgmt-node0` with virtual BMC (sushy-emulator)
- Bootstrap kubeconfig: `~/.kube/config` (KIND context `kind-sylva`)
