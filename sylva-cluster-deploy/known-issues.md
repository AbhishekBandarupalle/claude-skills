# Known Issues — Sylva OKD Management Cluster (cabpoa/capm3)

Issues encountered during deployment and their fixes. Organized by deployment phase.

---

## Phase: Bootstrap (KIND)

### KIND cluster already exists

**Symptom**: `bootstrap.sh` exits with "Please delete it using kind delete cluster"  
**Fix**: `kind delete cluster --name sylva` then re-run.

### Pivot already ran

**Symptom**: `bootstrap.sh` exits with "The pivot job has already ran"  
**Fix**: Use `apply.sh` instead, or delete KIND and kubeconfig for a fresh deploy.

---

## Phase: BMH Provisioning

### BMH stuck in registering/inspecting

**Symptom**: `oc get bmh -n sylva-system` shows `registering` or `inspecting` for >10 min.  
**Diagnosis**:
```bash
oc describe bmh <name> -n sylva-system | tail -20
oc logs -n metal3-system deployment/metal3-ironic --tail=50
oc logs -n metal3-system deployment/metal3-baremetal-operator --tail=50
```
**Common causes**:
- Ironic can't reach BMC → check `bmc.address` in values.yaml
- Boot MAC mismatch → verify `bootMACAddress`
- IPMI/Redfish credentials wrong → check `secrets.yaml`

### BMH goes to `available` but never `provisioning`

**Symptom**: BMH is `available` but Machine stays `Pending`.  
**Diagnosis**: Check that `hostSelector.matchLabels` in control_plane config matches `bmh_metadata.labels`.

---

## Phase: Pivot

### clusterctl move only transfers 3 objects (cabpoa CRDs missing label)

**Symptom**: `clusterctl move` output says "Creating 3 objects" instead of ~22+. Post-pivot, management creates duplicate CAPI objects.  
**Root cause**: cabpoa CRDs (`openshiftassistedcontrolplanes`, `openshiftassistedconfigs`, `clusterdeployments`, `agentclusterinstalls`, `infraenvs`) lack `clusterctl.cluster.x-k8s.io` label.  
**Fix** (already in `pivot.sh`): Label CRDs before move:
```bash
kubectl label crd agentclusterinstalls.extensions.hive.openshift.io clusterctl.cluster.x-k8s.io/move="" --overwrite
kubectl label crd infraenvs.agent-install.openshift.io clusterctl.cluster.x-k8s.io/move="" --overwrite
kubectl label crd openshiftassistedcontrolplanes.controlplane.cluster.x-k8s.io clusterctl.cluster.x-k8s.io="" --overwrite
kubectl label crd openshiftassistedconfigs.bootstrap.cluster.x-k8s.io clusterctl.cluster.x-k8s.io="" --overwrite
kubectl label crd clusterdeployments.hive.openshift.io clusterctl.cluster.x-k8s.io="" --overwrite
```
**File**: `charts/sylva-units/scripts/pivot.sh`

### BMH re-inspects after pivot (not detached before Ironic scale-down)

**Symptom**: After pivot, management's fresh Ironic triggers re-inspection → node powers off → cluster dies.  
**Root cause**: BMH must be detached (`baremetalhost.metal3.io/detached` annotation) **while Ironic is still running** on bootstrap.  
**Fix** (already in `pivot.sh`): Detach before Ironic scale-down:
```bash
kubectl annotate bmh "$bmh" -n $RELEASE_NAMESPACE baremetalhost.metal3.io/detached="" --overwrite
# Wait for operationalStatus=detached
kubectl scale deployment --replicas=0 metal3-ironic -n metal3-system  # Only after detach
```

### BMH paused after pivot (cabpoa doesn't auto-unpause)

**Symptom**: BMH shows `provisioned` but CAPM3 doesn't progress Machine. `baremetalhost.metal3.io/paused` annotation is set.  
**Root cause**: `clusterctl move` sets pause annotation; RKE2ControlPlane auto-unpauses but OACP does not.  
**Fix** (already in `pivot.sh`):
```bash
mgmt_kubectl annotate bmh --all baremetalhost.metal3.io/paused- -n $RELEASE_NAMESPACE
```

### OACP stuck in "Installing" after pivot (status not transferred)

**Symptom**: OACP shows `Available=False`, ACI stuck in `pending-for-input`, Cluster shows `ControlPlaneInitialized=False`.  
**Root cause**: `clusterctl move` creates objects without status subresource. OACP controller reads ACI status and overwrites any OACP status patches.  
**Critical**: Patching OACP status alone is NOT sufficient — the OACP controller will overwrite it based on ACI state. Must also patch ClusterDeployment and ACI.  
**Fix** (in `pivot.sh`): Three-level patch after move:
1. `ClusterDeployment.spec.installed=true` — tells assisted-installer the cluster exists
2. ACI status: `Completed=True`, `RequirementsMet=True`, `Validated=True`
3. OACP status: `Available=True`, `Ready=True`, `MachinesReady=True`, `KubeconfigAvailable=True`
4. Cluster status: `ControlPlaneInitialized=True`

The ClusterDeployment patch is the key — without it, the assisted-installer controller treats the moved ACI as a new install request and the OACP controller overwrites status patches.  
**File**: `charts/sylva-units/scripts/pivot.sh`

### externallyProvisioned incompatible with CAPM3

**Symptom**: Setting `externallyProvisioned: true` on BMH prevents CAPM3 from setting providerID.  
**Root cause**: CAPM3's `IsBaremetalHostProvisioned` only accepts `state: provisioned`, not `state: externally provisioned`.  
**Fix**: Do not set `externallyProvisioned: true`. Let BMH arrive via `clusterctl move` with its `baremetalhost.metal3.io/status` annotation preserving `provisioned` state.

---

## Phase: Management Units (Post-Pivot)

### Kube-job pods fail with SCC violation

**Symptom**: Flux kustomizations like `longhorn-pre-diskcheck`, `fix-keycloak-ownerrefs`, etc. stuck. Events show `FailedCreate` with SCC denial.  
**Root cause**: Sylva kube-jobs use `runAsUser: 1000` but OKD requires an SCC. The `sylva-kube-job-scc` originally only covered `system:serviceaccounts:sylva-system`.  
**Diagnosis**:
```bash
oc get events -A --field-selector reason=FailedCreate | grep -i scc
oc get jobs -A | grep -v Complete
```
**Fix**: Set SCC group to `system:serviceaccounts` (cluster-wide) instead of per-namespace:
```yaml
# kustomize-units/openshift-security-context-constraints/components/kube-job/scc.yaml
groups:
- system:serviceaccounts
```
**File**: `kustomize-units/openshift-security-context-constraints/components/kube-job/scc.yaml`

### MCE operator_condition_name fails on non-OKD management

**Symptom**: MCE webhook fails, operator stuck. Happens when RKE management runs MCE for OKD workloads.  
**Root cause**: MCE chart defaults assume OKD (service-ca, OLM). RKE doesn't have these.  
**Fix options**:
1. **Sylva-side**: Gate values on `bootstrap_provider == "cabpoa"` in `charts/sylva-units/values.yaml`
2. **Chart-side** (preferred): Add `isOCP` helper using `lookup "v1" "Namespace" "" "openshift-config"`
**File**: `charts/sylva-units/values.yaml` → `okd-openshift-mce` unit values

### Longhorn unit timeout during MCP reboot (per-unit sylvactl timeout)

**Symptom**: `bootstrap.sh` exits with `Unit timeout exceeded: unit Kustomization/longhorn did not become ready after 5m0s`. The `longhorn-okd-disk-sno` MachineConfig triggers an MCP reboot (~10-15 min), and `longhorn` depends on `longhorn-okd-disk-sno`.  
**Root cause**: `longhorn-okd-disk-sno` has `sylvactl/unitTimeout: 45m` but `longhorn` itself has the default 5m. When sylvactl hits a per-unit timeout, it exits the entire script.  
**Fix**: Add `sylvactl/unitTimeout: 45m` to the `longhorn` unit in environment values:
```yaml
# environment-values/my-okd-capm3/values.yaml
units:
  longhorn:
    annotations:
      sylvactl/unitTimeout: 45m
```
**Note**: This is an env-values change (local), not a chart change. The MCP reboot is expected — do not flag `longhorn` or `longhorn-okd-disk-sno` as stuck during this window.

### Longhorn disk precheck timeout (upgrade-only units)

**Symptom**: `longhorn-pre-diskcheck`, `longhorn-volumes-healthy`, `longhorn-instance-manager-cleanup` kustomizations stuck on first `apply.sh` run.  
**Root cause**: These are `is_upgrade` gated units. First `apply.sh` on a newly bootstrapped cluster triggers them. They run kube-jobs in `longhorn-system` namespace.  
**Fix**: Ensure SCC covers `longhorn-system` (see kube-job SCC fix above).

### openshift-assisted-installer depends on longhorn (breaking dependency)

**Symptom**: On cabpoa, `openshift-assisted-installer` blocks waiting for `longhorn` which hasn't deployed yet.  
**Root cause**: `openshift-assisted-installer` has a dependency on the default storage class unit. With cabpoa, MCE manages assisted-installer and longhorn isn't needed yet.  
**Fix**: Make dependency conditional on non-cabpoa providers:
```yaml
# charts/sylva-units/values.yaml, openshift-assisted-installer unit:
depends_on:
  '{{ .Values._internal.default_storage_class_unit }}': '{{ ne .Values.cluster.capi_providers.bootstrap_provider "cabpoa" | include "preserve-type" }}'
```
**File**: `charts/sylva-units/values.yaml`

### Vault/Keycloak/Crossplane blocked by upstream unit

**Symptom**: Downstream units show `dependency 'X' is not ready`.  
**Diagnosis**: Trace the dependency chain upward:
```bash
flux get kustomizations -n sylva-system | grep False
# For each failing unit, check what it depends on
oc get kustomization <unit> -n sylva-system -o jsonpath='{.spec.dependsOn}'
```
**Fix**: Fix the root upstream unit first; downstream units will cascade to Ready.

### capi-providers-pivot-ready timeout

**Symptom**: `bootstrap.sh` fails waiting for `capi-providers-pivot-ready` on management.  
**Diagnosis**: Check which CAPI provider kustomizations aren't ready on management:
```bash
export KUBECONFIG=~/sylva-core/management-cluster-kubeconfig
flux get kustomizations -n sylva-system | grep -E "capi|capm3|cabpoa|mce"
```
**Common causes**: MCE not deployed, CRDs missing, SCC blocking pods.

---

## Phase: Workload Cluster

*(To be added after management cluster is 100% done)*

---

## General Debugging Tips

### Force Flux reconciliation
```bash
flux reconcile kustomization <name> -n sylva-system
flux reconcile helmrelease <name> -n sylva-system
```

### Check sylva-units-status (overall readiness)
```bash
flux get kustomization sylva-units-status -n sylva-system
```

### View all unit statuses
```bash
flux get kustomizations -n sylva-system --no-header | sort -k4
```

### Check OwnerReference chain (CAPI objects)
```bash
for kind in cluster oacp machine metal3machine bmh; do
  echo "=== $kind ==="
  oc get $kind -n sylva-system -o jsonpath='{.items[0].metadata.name}: owner={.items[0].metadata.ownerReferences[0].kind}/{.items[0].metadata.ownerReferences[0].name}'
  echo
done
```

### Recover management kubeconfig from bootstrap
```bash
kubectl get secret management-cluster-kubeconfig-copy -o jsonpath='{.data.value}' | base64 -d > management-cluster-kubeconfig
```
