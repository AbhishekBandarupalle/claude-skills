# Management Repair

Detect cluster state, diagnose failures, apply fixes, and retry.

## Step 2: Detect State

```bash
kind get clusters 2>/dev/null | grep sylva
ls -la ~/sylva-core/management-cluster-kubeconfig
export KUBECONFIG=~/sylva-core/management-cluster-kubeconfig && oc get nodes
```

- KIND exists, no mgmt kubeconfig → bootstrap running or failed pre-pivot
- KIND exists, mgmt reachable → pivot in progress or failed
- No KIND, mgmt reachable → post-pivot, management running
- Neither → need full redeploy (see [mgmt-redeploy.md](mgmt-redeploy.md))

## Step 3: Active Monitoring

### Deployment phases

1. KIND bootstrap (~2 min)
2. Flux + sylva-units-operator (~3 min)
3. Bootstrap units (~15 min)
4. BMH provisioning + OKD install (~20-30 min)
5. Pivot (~10 min)
6. Management units (~20 min)
7. "All done"

### Monitor ACI events

Once BMH reaches `provisioning`:
```bash
EVENTS_URL=$(kubectl get aci ${CLUSTER_NAME}-control-plane -n sylva-system -o yaml | grep -i eventsURL | cut -d':' -f2-)
curl -k $EVENTS_URL | jq .
```
Poll every 2-3 min. Watch for `"All is well"` or errors about bootstrap/etcd/api.

### Watch kustomizations

```bash
kubectl get kustomizations.kustomize.toolkit.fluxcd.io -n sylva-system --no-headers | awk '$3 != "True"'
```

For stuck >15 min:
```bash
kubectl get kustomization <name> -n sylva-system -o jsonpath='{.status.conditions[?(@.type=="Ready")].message}'
```

If `DependencyNotReady`: trace via `{.spec.dependsOn}`.
If `HealthCheckFailed`: check HelmRelease status + pods.

**Expected long waits** (not issues): `cluster` (OACP ~20-30m), `cluster-machines-ready`,
`longhorn-okd-disk-sno`/`longhorn` (MCP reboot ~15m), `pivot`, `capi-providers-pivot-ready`.

**Flag these**: `InstallFailed`/`UpgradeFailed` HelmReleases, `CrashLoopBackOff`/`ImagePullBackOff`
pods, SCC violations, dependency loops.

## Step 4: Diagnosis

Check [encountered-issues.md](encountered-issues.md) first.

```bash
flux get kustomizations -n sylva-system | grep -v "True"
flux get helmreleases -n sylva-system | grep -v "True"
oc get pods -A | grep -v "Running\|Completed\|Succeeded" | grep -v "NAMESPACE"
oc get events -A --sort-by='.lastTimestamp' | grep -i "error\|fail\|warning" | tail -20
oc get events -A --field-selector reason=FailedCreate | grep -i "scc\|security"
```

For pivot issues:
```bash
oc get cluster,machine,bmh,metal3machine -n sylva-system
oc get openshiftassistedcontrolplane -n sylva-system
```

## Step 5: Apply Fix

1. Identify root cause
2. Check [known-issues.md](known-issues.md)
3. Make code change
4. Follow the Commit & Push Procedure in SKILL.md
5. Re-run:
   - Pre-pivot:
     ```bash
     tmux new-session -d -s sylva-deployment \
       "cd ~/sylva-core && source bin/env && unset KUBECONFIG && BOOTSTRAP_WATCH_TIMEOUT_MIN=$WATCH_TIMEOUT MGMT_WATCH_TIMEOUT_MIN=$WATCH_TIMEOUT ./bootstrap.sh environment-values/my-okd-capm3 2>&1 | tee bootstrap.log; exec bash"
     ```
   - Post-pivot:
     ```bash
     tmux new-session -d -s sylva-deployment \
       "cd ~/sylva-core && source bin/env && unset KUBECONFIG && APPLY_WATCH_TIMEOUT_MIN=$WATCH_TIMEOUT ./apply.sh environment-values/my-okd-capm3 2>&1 | tee apply.log; exec bash"
     ```

## Step 6: Retry Loop

1. Resume monitoring (Step 3)
2. New failure → back to Step 4
3. Continue until "All done"

## Key Files

| File | Purpose |
|------|---------|
| `bootstrap.sh` | Full deploy: KIND → bootstrap → pivot → management |
| `apply.sh` | Update/retry on existing management cluster |
| `charts/sylva-units/values.yaml` | Unit definitions, dependencies |
| `charts/sylva-units/bootstrap.values.yaml` | Bootstrap-only overrides |
| `charts/sylva-units/management.values.yaml` | Management-only overrides |
| `environment-values/my-okd-capm3/` | Environment config |
| `kustomize-units/openshift-security-context-constraints/` | OKD SCCs |

## Environment

- Env path: `environment-values/my-okd-capm3`
- Bootstrap: `cabpoa`, Infra: `capm3`
- OKD version: from `values.yaml` → `cluster.openshift.version`
- SNO: `control_plane_replicas: 1`
- Mgmt kubeconfig: `~/sylva-core/management-cluster-kubeconfig`
