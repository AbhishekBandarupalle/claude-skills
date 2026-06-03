---
name: learn-sylva-units
description: >-
  Deep-dive into what a Sylva unit does across all cluster distributions (RKE2, OKD, etc.).
  Investigates unit definitions, resources created, dependencies, Kyverno policies,
  and cross-distribution behavior. Automatically calls suggest-adaptation when done.
  Use when the user asks what a unit does, how it works, or wants to understand a unit
  before enabling it on OKD.
---

# Learn Sylva Units

Investigates what a Sylva unit does **across all cluster distributions** (RKE2,
OKD, etc.) — not just the current local setup. The goal is to build a complete
picture so the unit can be adapted to OKD or issues can be fixed.

## Pipeline

This agent is the first step in a three-agent chain:

```
Learn (this agent) → Suggest (suggest-adaptation) → Deploy (sylva-cluster-deploy)
```

After presenting the summary, this agent **automatically calls suggest-adaptation**
as a sub-agent to propose OKD adaptation paths.

## Investigation Steps

### L1. Unit Definition

Read the unit entry from `charts/sylva-units/values.yaml`. Search for the
unit name and extract:

- **Type**: HelmRelease (`helmrelease_spec`) or Kustomization (`kustomization_spec`)
- **Source repo**: which `source_templates` entry it uses
- **Path**: the `kustomization_spec.path` (e.g. `./kustomize-units/<unit>/`)
- **Target namespace**: `targetNamespace` if set
- **Info**: `info.description` and `info.maturity`
- **Enabled conditions**: any `enabled_conditions` — which providers/distributions
  enable this unit (e.g. `unit-enabled "rke2"`, `unit-enabled "openshift"`,
  `infra_provider == "capo"`, etc.). This tells you which platforms the unit was
  designed for and whether it's currently excluded from OKD.
- **Phases**: does it appear in `bootstrap.values.yaml` or `management.values.yaml`
- **Overrides per distribution**: check if `bootstrap.values.yaml` or
  `management.values.yaml` have distribution-specific overrides for this unit
  (e.g. different values for RKE2 vs OKD)

### L2. Dependencies

From the unit definition, extract:

- **`depends_on`**: list all dependencies and whether each is `true` (hard) or a condition
- **`_templates`**: check if the unit inherits from templates like `base-deps`
- For each dependency, briefly describe what that dependency unit does (read its
  `info.description` from `values.yaml`)
- **Reverse dependencies**: search `values.yaml` for other units that have this
  unit in their `depends_on` — these are the units that depend on *it*

### L3. Resources Created

Read the unit's source files to understand what it deploys:

**For kustomize units** (`kustomization_spec.path` → `kustomize-units/<unit>/`):
```bash
ls -R ~/sylva-core/kustomize-units/<unit>/
```
Read the `kustomization.yaml` and all resource files. Look for:
- Deployments, DaemonSets, StatefulSets
- Services, Ingresses
- ConfigMaps, Secrets
- CRDs, Custom Resources
- ServiceAccounts, RBAC (Roles, ClusterRoles, RoleBindings)
- Namespaces

Check for **distribution-specific overlays or variants**:
- Subdirectories like `base/`, `okd/`, `rke2/`, `openshift/` — the kustomization
  path may point to a specific overlay (e.g. `./kustomize-units/<unit>/okd`)
- Conditional patches or resources gated by `postBuild.substitute` variables
  (e.g. `CLUSTER_DISTRIBUTION`, `INFRA_PROVIDER`)
- If the unit has only a `base/` directory with no OKD overlay, note this — it
  may need OKD-specific adaptations (SCCs, different image registries, etc.)

**For HelmRelease units** (`helmrelease_spec`):
- Read the chart reference (repo, chart name, version)
- Check `helmrelease_spec.values` for configured values
- Check `kustomization_spec.postBuild.substitute` for variable substitutions
- Look for distribution-conditional values (templates using
  `cluster_distribution`, `bootstrap_provider`, `infra_provider`)

### L4. Cluster Impact & Distribution Behavior

Determine which cluster(s) the unit affects:

- **Bootstrap cluster** (KIND): unit appears in `bootstrap.values.yaml`
- **Management cluster**: unit appears in `management.values.yaml` or has
  no phase override (defaults to management)
- **Workload clusters**: unit creates resources on workload clusters (look for
  CAPI cluster references, remote kubeconfig usage)

Check what the unit does at a system level:
- Does it install an operator? What CRDs does the operator manage?
- Does it configure networking (CNI, load balancers, DNS)?
- Does it manage storage (CSI drivers, PVs)?
- Does it handle security (certificates, auth, policies)?
- Does it run one-time jobs (init, migration, setup)?

**Cross-distribution analysis** — this is the key part for adapting units:

- **On RKE2**: How does the unit run? What assumptions does it make about the
  cluster (e.g. PodSecurityStandards, default CNI, storage classes)?
- **On OKD**: What OKD-specific concerns apply?
  - Does it need SecurityContextConstraints (SCCs)?
  - Does it use `hostNetwork`, `hostPort`, `hostPath`, or privileged containers?
  - Does it assume a specific CNI (Calico vs OVN-Kubernetes)?
  - Does it use images from registries that need mirroring?
  - Does it create MachineConfigPool changes that trigger node reboots?
- **Gaps**: If the unit works on RKE2 but has no OKD support, list what would
  need to change (SCCs, image refs, CNI assumptions, RBAC differences)

### L5. Kyverno Policies

Check if any Kyverno policies affect this unit:

```bash
ls ~/sylva-core/kustomize-units/kyverno-policies/
```

Search for policies that reference the unit's namespace or resources:

- Read each relevant policy directory under `kustomize-units/kyverno-policies/`
- Check `charts/sylva-units/values.yaml` for Kyverno policy units that have
  this unit in their `depends_on` or `enabled_conditions`
- Look for ClusterPolicy / Policy resources that match on the unit's namespace,
  labels, or resource kinds

For each policy found, describe:
- What it mutates or validates
- When it triggers (on create, update, or both)
- How it affects the unit's resources

### L6. Live State (if cluster is running)

If a cluster is reachable, also check live state:

```bash
export KUBECONFIG=~/sylva-core/management-cluster-kubeconfig

kubectl get kustomization <unit> -n sylva-system -o yaml
kubectl get helmrelease <unit> -n sylva-system -o yaml
kubectl get all -n <target-namespace>
kubectl get events -n <target-namespace> --sort-by='.lastTimestamp' | tail -20
```

### L7. Present the Summary

Present the findings as a structured summary:

```
Unit: <name>
Type: <HelmRelease | Kustomization>
Phase: <bootstrap | management | both>
Enabled on: <list distributions — e.g. RKE2, OKD, all>
Status: <from live state, or "cluster not reachable">

## What It Does
<2-3 sentence description of the unit's main functionality>

## Resources Created
- <resource kind>/<name> in <namespace>
- ...

## Cluster Impact
- Affects: <bootstrap / management / workload>
- <describe system-level impact>

## Distribution Behavior
| Aspect | RKE2 | OKD |
|--------|------|-----|
| Enabled | yes/no | yes/no |
| SCCs needed | N/A | <list or "none"> |
| CNI assumptions | <e.g. Calico> | <e.g. OVN-Kubernetes> |
| Privileged access | <yes/no, what> | <needs SCC: ...> |
| Image registries | <default> | <needs mirror?> |
| MCP reboots | N/A | <yes/no> |
| Known gaps | — | <what needs adapting> |

## Dependencies
| Unit | Type | Description |
|------|------|-------------|
| ... | hard/conditional | ... |

## Depended On By
| Unit | Description |
|------|-------------|
| ... | ... |

## Kyverno Policies
| Policy | Effect |
|--------|--------|
| ... | ... |
(or "None" if no policies affect this unit)

## Configuration
- Key values and substitutions from the unit definition
```

### L8. Write Summary to Shared Context

Append the full summary to `~/sylva-core/.agent-session.md` so the downstream
agents (suggest-adaptation and sylva-cluster-deploy) have the context:

```markdown
### Learn: Unit <name>
<DATE_TIME>

<paste the full L7 summary here>
```

### L9. Call Suggest Adaptation

After presenting the summary, **automatically call suggest-adaptation** as a
sub-agent using the Task tool:

```
subagent_type: generalPurpose
description: "Suggest OKD adaptation for <unit>"
prompt: |
  Read the skill at /home/abhi/.cursor/skills/suggest-adaptation/SKILL.md and follow it.
  Working directory: ~/sylva-core
  Unit: <unit name>
  The Learn summary has been written to ~/sylva-core/.agent-session.md — read it for full context.
  Present adaptation options to the user and wait for their choice.
  After they choose, record the decision and hand off to the deploy agent.
```
