---
name: suggest-adaptation
description: >-
  Suggest adaptation paths for enabling a Sylva unit on OKD/OCP.
  Takes the output of the Learn mode investigation and proposes concrete
  approaches — using OpenShift-native components, adding SCCs, creating overlays,
  or replacing with OKD equivalents. Presents multiple options for the user to choose from.
  Use when the user asks how to adapt, enable, or port a unit to OKD/OCP,
  or after a Learn mode deep-dive when the next step is adaptation.
disable-model-invocation: true
---

# Suggest Adaptation

Proposes adaptation paths for enabling a Sylva unit on OKD/OCP. This skill
sits between **Learn** and **Deploy** in the workflow:

```
Learn (understand unit) → Suggest (propose adaptation paths) → Deploy (implement chosen path)
```

## Input

This skill expects the Learn mode summary to already exist — either from the
current conversation or written to `.agent-session.md`. The key data needed:

- Unit name and type (HelmRelease / Kustomization)
- Resources it creates (pods, services, CRDs, etc.)
- Distribution behavior table (what works on RKE2, what's missing for OKD)
- Dependencies and Kyverno policies
- Known gaps identified by Learn mode

If the Learn summary is not available, run Learn mode first.

## Adaptation Analysis

### S1. Identify Blockers

From the Learn summary, extract every reason the unit cannot run on OKD as-is.
Common blockers:

| Blocker | Example |
|---------|---------|
| Missing SCC | Pods need `hostNetwork`, `hostPath`, privileged, or specific capabilities |
| CNI mismatch | Unit assumes Calico but OKD uses OVN-Kubernetes |
| OKD has a built-in equivalent | Monitoring (Prometheus → OKD Monitoring), DNS (CoreDNS → OKD DNS), Ingress (nginx → OKD Router) |
| Image registry | Images not available in OKD-accessible registries, need mirroring |
| API differences | Uses APIs not present on OKD, or OKD has different API versions |
| MachineConfig / MCP | Changes require node-level config that triggers MCP reboots |
| RBAC differences | OKD has stricter default RBAC, or uses different groups/subjects |
| CRD conflicts | Unit installs CRDs that conflict with OKD-managed CRDs |

### S2. Generate Paths

For each blocker (or group of related blockers), generate adaptation paths.
Always consider these categories:

**Path A: Use the same unit + add OKD compatibility**
- Add SCCs for pods that need elevated privileges
- Add RBAC bindings for OKD-specific groups
- Create an OKD kustomize overlay (`kustomize-units/<unit>/okd/`)
- Add `postBuild.substitute` overrides for OKD-specific values
- Add registry mirror entries for images
- Add Kyverno policies to mutate resources for OKD

**Path B: Use OpenShift-native components instead**
- Replace with built-in OKD operators or features:
  - Monitoring → OpenShift Monitoring (Cluster Monitoring Operator)
  - Ingress → OpenShift Router
  - DNS → OpenShift DNS
  - Certificates → cert-manager or service-serving-cert-signer
  - Registry → OpenShift internal registry
  - Logging → OpenShift Logging (ClusterLogging operator)
  - Storage → OKD CSI drivers (already present)
- Create a new OKD-specific unit that wraps the OpenShift component
  with Sylva's unit structure (kustomization, dependencies, health checks)

**Path C: Disable and exclude from OKD**
- If the unit's function is already fully covered by OKD built-ins with
  no gap, disable it via `enabled_conditions` for OKD
- Document why it's excluded

**Path D: Hybrid approach**
- Use some functionality from the original unit + supplement with OKD components
- Example: keep the unit's CRDs/operator but replace its networking assumptions

### S3. Evaluate Each Path

For every path, assess:

| Criteria | Evaluate |
|----------|----------|
| **Effort** | How many files need to change? New files? |
| **Risk** | Could this break other units or distributions? |
| **Maintainability** | Will this create ongoing merge conflicts or drift? |
| **Completeness** | Does this fully solve the blocker or just work around it? |
| **Upstream alignment** | Is this how upstream Sylva would do it, or a local hack? |

### S4. Present Options

Present each path as a concrete option the user can choose from.
Use the AskQuestion tool if available. Format:

```
## Adaptation Options for unit: <name>

### Blockers Identified
1. <blocker 1>
2. <blocker 2>
...

### Option 1: <short name> (Path A/B/C/D)
**Approach**: <1-2 sentence description>
**Changes needed**:
- <file>: <what to change>
- <file>: <what to create>
**Effort**: <low / medium / high>
**Risk**: <low / medium / high>
**Trade-off**: <what you gain vs what you lose>

### Option 2: <short name>
...

### Recommendation
<which option and why — but let the user decide>
```

### S5. Record Decision

After the user chooses, append the decision to `.agent-session.md`:

```markdown
### Adaptation Decision: <unit name>
<DATE_TIME>

- **Blockers**: <list>
- **Options considered**: <brief list>
- **Chosen path**: <option number and name>
- **Rationale**: <why the user chose this>
- **Changes to implement**: <specific file list>
```

This provides context for the deploy agent and the code-validate agent when
the changes are committed.

### S6. Call Deploy Agent

After recording the decision, **automatically call sylva-cluster-deploy** as
a sub-agent to implement the chosen adaptation:

```
subagent_type: generalPurpose
description: "Deploy OKD adaptation for <unit>"
prompt: |
  Read the skill at /home/abhi/.cursor/skills/sylva-cluster-deploy/SKILL.md and follow it.
  Working directory: ~/sylva-core

  An adaptation decision has been recorded in ~/sylva-core/.agent-session.md — read it
  for full context including the Learn summary and the chosen adaptation path.

  Implement the following changes for unit <unit name>:
  <list the specific changes from the chosen option>

  Follow the Commit & Push Procedure (commit, call code-validate, push only after APPROVED).
  Then run apply.sh to deploy the changes to the cluster.
```

Tell the user:
```
Adaptation path selected. Handing off to the deploy agent to implement the changes.
```
