# Claude Skills

Cursor agent skills for Sylva infrastructure automation.

## Skills

### learn-sylva-units

Deep-dive into what a Sylva unit does across all cluster distributions (RKE2, OKD, etc.). Investigates unit definitions, resources, dependencies, Kyverno policies, and cross-distribution behavior. Automatically calls **suggest-adaptation** when done.

```
learn-sylva-units/
└── SKILL.md
```

---

### suggest-adaptation

Proposes adaptation paths for enabling a Sylva unit on OKD/OCP. Takes the Learn output, identifies blockers, generates multiple options (add SCCs, use OpenShift-native, hybrid, disable), and presents them for the user to choose. Automatically calls **sylva-cluster-deploy** after the user picks.

```
suggest-adaptation/
└── SKILL.md
```

---

### sylva-cluster-deploy

Deploy, repair, and redeploy Sylva OKD management clusters on bare metal (cabpoa/capm3). Also the final step in the Learn → Suggest → Deploy pipeline. All code changes go through **code-validate** before being pushed.

**Capabilities:**

- Full redeploy from scratch (teardown + bootstrap.sh)
- Repair mode (diagnose failures, apply fixes, retry)
- Active monitoring of kustomizations, HelmReleases, pods, and ACI events
- Known issue catalog with tested fixes
- Automatic retry loop until all Sylva units are ready

```
sylva-cluster-deploy/
├── SKILL.md
├── encountered-issues.md
├── known-issues.md
└── scripts/
    └── check-cluster-health.sh
```

---

### code-validate

Gate-keeper agent that reviews code changes before they are pushed. Called as a sub-agent by sylva-cluster-deploy after committing but before pushing.

**What it does:**

- Reads the shared session context to understand the full session history
- Reviews commit diffs for purpose alignment, scope limitation, and regressions
- Checks for contradictions with previously approved commits
- Returns `APPROVED`, `CONTRADICTION`, or `REJECTED` with actionable details
- Logs approved commits to a clean audit trail
- Supports re-submission with justification for intentional contradictions

```
code-validate/
└── SKILL.md
```

---

## Shared Agent Memory

All agents read and write shared files in `~/sylva-core/`:

| File | Purpose | Writers |
|------|---------|---------|
| `.agent-session.md` | Shared memory — session goal, learn summaries, adaptation decisions, fix attempts, review notes | All agents |
| `.code-validate-log.md` | Clean audit trail of approved commits only | code-validate |

## Architecture

Four-agent system for understanding, adapting, deploying, and validating Sylva units on OKD clusters.

### Agent Pipeline

```mermaid
flowchart TD
    User([User]):::user -->|what does unit X do / enable unit X on OKD| Learn

    subgraph learn ["learn-sylva-units"]
        Learn[Investigate Unit<br/><i>definition, resources, deps,<br/>Kyverno policies, RKE2 vs OKD</i>]
        Summary[Write Summary<br/><i>to .agent-session.md</i>]
        Learn --> Summary
    end

    subgraph suggest ["suggest-adaptation"]
        ReadCtx[Read Learn Summary<br/><i>from .agent-session.md</i>]
        Blockers[Identify Blockers<br/><i>SCCs, CNI, images, APIs...</i>]
        Options[Generate Paths<br/><i>A: add SCCs  B: use OKD-native<br/>C: disable  D: hybrid</i>]
        UserPick[/User Picks Option/]
        RecordDecision[Record Decision<br/><i>to .agent-session.md</i>]
        ReadCtx --> Blockers --> Options --> UserPick --> RecordDecision
    end

    subgraph deploy ["sylva-cluster-deploy"]
        ReadDecision[Read Adaptation Decision<br/><i>from .agent-session.md</i>]
        Implement[Implement Changes<br/><i>edit charts, kustomize, SCCs...</i>]
        WriteAttempt[Write Fix Attempt<br/><i>to .agent-session.md</i>]
        Commit[git add + commit<br/><i>no push yet</i>]
        CallCV[Call code-validate]
        Push[git push]
        Revise[Revise or Justify]
        RunScript[Run apply.sh / bootstrap.sh]

        ReadDecision --> Implement --> WriteAttempt --> Commit --> CallCV
    end

    subgraph validate ["code-validate"]
        ReadAll[Read Shared Memory<br/><i>.agent-session.md +<br/>.code-validate-log.md</i>]
        ReviewDiff[Review Commit + Diff<br/><i>7 criteria</i>]
        Decision{Verdict}
        WriteReview[Write Review Notes<br/><i>to .agent-session.md</i>]

        ReadAll --> ReviewDiff --> Decision
    end

    Summary -->|auto-calls| ReadCtx
    RecordDecision -->|auto-calls| ReadDecision
    CallCV -->|auto-calls| ReadAll

    Decision -->|APPROVED| WriteReview
    Decision -->|CONTRADICTION| WriteReview
    Decision -->|REJECTED| WriteReview

    WriteReview -->|APPROVED| Push
    WriteReview -->|CONTRADICTION / REJECTED| Revise

    Push --> RunScript
    RunScript -->|new failure| Implement
    Revise -->|re-commit| Commit

    classDef user fill:#334155,color:#e2e8f0,stroke:#94a3b8
    classDef default fill:#1e293b,color:#e2e8f0,stroke:#334155
    style learn fill:none,stroke:#ef4444,stroke-width:2px,color:#f87171
    style suggest fill:none,stroke:#eab308,stroke-width:2px,color:#facc15
    style deploy fill:none,stroke:#3b82f6,stroke-width:2px,color:#60a5fa
    style validate fill:none,stroke:#22c55e,stroke-width:2px,color:#4ade80
```

### Shared Memory

```mermaid
flowchart LR
    subgraph files ["Shared Files in ~/sylva-core/"]
        Session[".agent-session.md<br/><i>learn summaries, adaptation decisions,<br/>fix attempts, review notes</i>"]
        Log[".code-validate-log.md<br/><i>clean audit trail of<br/>approved commits only</i>"]
    end

    LearnAgent([learn-sylva-units]):::learn
    SuggestAgent([suggest-adaptation]):::suggest
    DeployAgent([sylva-cluster-deploy]):::deploy
    ValidateAgent([code-validate]):::validate

    LearnAgent -->|writes unit<br/>summary| Session
    SuggestAgent -.->|reads learn<br/>summary| Session
    SuggestAgent -->|writes adaptation<br/>decision| Session
    DeployAgent -.->|reads decision<br/>+ prior feedback| Session
    DeployAgent -->|writes fix<br/>attempt entries| Session
    ValidateAgent -.->|reads full<br/>session context| Session
    ValidateAgent -->|writes review<br/>notes for all verdicts| Session
    ValidateAgent -->|writes approved<br/>commit entries| Log
    ValidateAgent -.->|reads commit<br/>history| Log

    classDef learn fill:#450a0a,color:#fca5a5,stroke:#ef4444
    classDef suggest fill:#422006,color:#fde047,stroke:#eab308
    classDef deploy fill:#1e3a5f,color:#93c5fd,stroke:#3b82f6
    classDef validate fill:#052e16,color:#86efac,stroke:#22c55e
    style files fill:none,stroke:#eab308,stroke-width:2px,color:#facc15
```

### Decision Outcomes

```mermaid
flowchart LR
    A[APPROVED]:::approved -->|log + push| Push[git push → run script]
    C[CONTRADICTION]:::contradiction -->|conflicting commits + detail| Choose{Deploy agent}
    Choose -->|unintentional| Revise[Revise code]
    Choose -->|intentional| Justify[Re-submit with JUSTIFICATION]
    R[REJECTED]:::rejected -->|reason + action| Fix[Reset commit, fix, re-submit]

    classDef approved fill:#166534,color:#fff,stroke:#22c55e
    classDef contradiction fill:#713f12,color:#fff,stroke:#eab308
    classDef rejected fill:#7f1d1d,color:#fff,stroke:#ef4444
```

---

## Setup

Git clone the repo to home directory:

```bash
git clone https://github.com/AbhishekBandarupalle/claude-skills.git ~/claude-skills
```

If using Cursor, add symlinks for Cursor:

```bash
ln -s ~/claude-skills/learn-sylva-units ~/.cursor/skills/learn-sylva-units
ln -s ~/claude-skills/suggest-adaptation ~/.cursor/skills/suggest-adaptation
ln -s ~/claude-skills/sylva-cluster-deploy ~/.cursor/skills/sylva-cluster-deploy
ln -s ~/claude-skills/code-validate ~/.cursor/skills/code-validate
```

If using Claude Code, add symlinks for Claude:

```bash
ln -s ~/claude-skills/learn-sylva-units ~/.claude/learn-sylva-units
ln -s ~/claude-skills/suggest-adaptation ~/.claude/suggest-adaptation
ln -s ~/claude-skills/sylva-cluster-deploy ~/.claude/sylva-cluster-deploy
ln -s ~/claude-skills/code-validate ~/.claude/code-validate
```

