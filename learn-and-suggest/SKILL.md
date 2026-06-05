---
name: learn-and-suggest
description: >-
  Investigate what a Sylva unit does across distributions (RKE2, OKD) and
  suggest OKD adaptation paths. Caches results for fast repeat lookups.
  Called by the /sylva dispatcher only.
disable-model-invocation: true
---

# Learn & Suggest

Investigates Sylva units across distributions and proposes OKD adaptation paths.

**Two modes** — detected from user intent:

- **Learn only**: "what does unit X do?", "explain unit X", "what depends on X"
  → investigate, present summary, stop.
- **Learn + Suggest + Deploy**: "enable unit X on OKD", "adapt unit X"
  → investigate, identify blockers, present options, user picks, hand off to deploy.

## Unit Cache

Results are persisted to `~/claude-skills/unit-cache.json` for fast repeat lookups.

**On query**: check cache first. If unit exists and user didn't say "update" or
"refresh", return cached data immediately. Otherwise run full investigation.

**On "update learnings"** or "refresh unit X": re-run investigation, overwrite cache.

**Dependency lookups**: "what depends on X?" answered from `_dependency_graph`
in the cache without reading `values.yaml`.

### Cache format

```json
{
  "<unit-name>": {
    "updated": "<ISO timestamp>",
    "type": "<HelmRelease|Kustomization>",
    "path": "<kustomization path>",
    "phase": "<bootstrap|management|both>",
    "enabled_on": ["rke2", "okd"],
    "description": "<1-line description>",
    "namespace": "<target namespace>",
    "resources": ["DaemonSet/speaker", "Deployment/controller"],
    "deps": ["base-deps", "kyverno"],
    "reverse_deps": ["metallb-resources"],
    "kyverno_policies": ["metal3-policies"],
    "gaps_okd": ["needs SCC for hostNetwork", "no OKD overlay"],
    "blockers_okd": ["missing-scc", "hostNetwork"]
  },
  "_dependency_graph": {
    "<unit>": {"depends_on": [...], "depended_by": [...]},
    ...
  }
}
```

## Investigation (L1-L6)

Run these steps for any unit not in cache (or when refreshing).

### L1. Unit Definition

Read the unit from `charts/sylva-units/values.yaml`:
- Type: HelmRelease (`helmrelease_spec`) or Kustomization (`kustomization_spec`)
- Source repo, path, target namespace
- `info.description`, `info.maturity`
- `enabled_conditions` — which distributions enable this unit
- Phase: check `bootstrap.values.yaml` and `management.values.yaml`
- Distribution-specific overrides in those files

### L2. Dependencies

- `depends_on` entries (hard vs conditional)
- `_templates` inheritance (e.g. `base-deps`)
- For each dep, read its `info.description`
- Reverse deps: search `values.yaml` for units with this unit in `depends_on`

### L3. Resources Created

**Kustomize units**: read `kustomize-units/<unit>/` — kustomization.yaml and
resource files. Note distribution overlays (`base/`, `okd/`, `rke2/`).

**HelmRelease units**: chart reference, `helmrelease_spec.values`,
`postBuild.substitute`, distribution-conditional templates.

### L4. Distribution Behavior

- RKE2: assumptions (PSS, CNI, storage classes)
- OKD: SCCs needed? hostNetwork/hostPath/privileged? CNI assumptions?
  Image mirroring? MCP reboots?
- Gaps: what needs to change for OKD support

### L5. Kyverno Policies

Check `kustomize-units/kyverno-policies/` and `values.yaml` for policy units
referencing this unit's namespace or resources.

### L6. Live State (if cluster reachable)

```bash
export KUBECONFIG=~/sylva-core/management-cluster-kubeconfig
kubectl get kustomization <unit> -n sylva-system -o yaml
kubectl get helmrelease <unit> -n sylva-system -o yaml
kubectl get all -n <target-namespace>
```

## After Investigation

1. **Update cache**: write/overwrite the unit entry and `_dependency_graph` in
   `~/claude-skills/unit-cache.json`.

2. **Present summary** to user (use tables for distribution behavior, deps).

3. **If Learn-only mode**: stop here.

4. **If Learn+Suggest mode**: continue to Suggest below.

## Suggest Adaptation (S1-S5)

### S1. Identify Blockers

Extract every reason the unit can't run on OKD as-is: missing SCCs, CNI
mismatch, OKD built-in equivalent, image registry, API differences, MCP
reboots, RBAC differences, CRD conflicts.

### S2. Generate Paths

**A: Same unit + OKD compatibility** — add SCCs, RBAC, OKD overlay, registry
mirrors, Kyverno mutations.

**B: OpenShift-native replacement** — use built-in OKD operators/features
(Monitoring, Router, DNS, Logging, CSI, cert-signer).

**C: Disable for OKD** — already covered by OKD built-ins, exclude via
`enabled_conditions`.

**D: Hybrid** — keep some parts, replace others with OKD components.

### S3. Evaluate & Present

For each path: effort, risk, maintainability, completeness, upstream alignment.
Present options using AskQuestion tool. Include recommendation.

### S4. Record Decision

Write to `~/sylva-core/.agent-session.md` in compact format:

```
## Decision: <option name> for <unit>
changes: <file list with action>
```

### S5. Call Deploy

```
subagent_type: generalPurpose
description: "Deploy OKD adaptation for <unit>"
prompt: |
  Read the skill at ~/claude-skills/sylva-cluster-deploy/SKILL.md and follow it.
  Working directory: ~/sylva-core
  Adaptation decision is in ~/sylva-core/.agent-session.md.
  Implement the changes: <list from chosen option>
  Follow Commit & Push Procedure, then run apply.sh.
```
