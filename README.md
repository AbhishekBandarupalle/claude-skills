# Claude Skills

Cursor agent skills for Sylva infrastructure automation.

## Skills

### sylva-cluster-deploy

Deploy, repair, upgrade, and redeploy Sylva OKD management clusters on bare metal (cabpoa/capm3). Runs bootstrap.sh or apply.sh, monitors Flux kustomizations, diagnoses failures, applies code fixes, and retries until all units are ready.

**Capabilities:**

- Full redeploy from scratch (teardown + bootstrap.sh)
- Repair mode (diagnose failures, apply fixes, retry)
- Upgrade mode (enable/disable units, version upgrades, config changes via apply.sh)
- Active monitoring of kustomizations, HelmReleases, pods, and ACI events
- Known issue catalog with tested fixes
- Health check script for quick status assessment
- Automatic retry loop until all Sylva units are ready

All code changes go through the **code-validate** agent before being pushed.

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

Both agents read and write shared files in `~/sylva-core/`:


| File                    | Purpose                                                                                    | Writers       |
| ----------------------- | ------------------------------------------------------------------------------------------ | ------------- |
| `.agent-session.md`     | Shared memory — session goal, fix attempts with reasoning, review notes from code-validate | Both          |
| `.code-validate-log.md` | Clean audit trail of approved commits only                                                 | code-validate |


## Architecture

Two-agent system for deploying and validating code changes on Sylva OKD management clusters.

### Workflow

```mermaid
flowchart TD
    User([User]):::user -->|triggers deploy / repair / upgrade| ReadEnv

    subgraph deploy ["sylva-cluster-deploy"]
        ReadEnv[Read Environment<br/><i>cluster name, node IP, disk config</i>]
        InitSession[Init Session Context<br/><i>write goal + mode to .agent-session.md</i>]
        Diagnose[Diagnose / Fix<br/><i>monitor cluster, trace failures, edit code</i>]
        WriteCtx[Write Fix Attempt<br/><i>append problem + approach to .agent-session.md</i>]
        Commit[git add + commit<br/><i>stage and commit locally, no push</i>]
        CallCV[Call code-validate sub-agent]
        Push[git push]
        Revise[Revise or Justify<br/><i>fix code or re-submit with JUSTIFICATION</i>]
        RunScript[Run bootstrap / apply<br/><i>deploy changes via tmux</i>]

        ReadEnv --> InitSession --> Diagnose --> WriteCtx --> Commit --> CallCV
    end

    subgraph validate ["code-validate"]
        ReadShared[Read Shared Memory<br/><i>.agent-session.md + .code-validate-log.md</i>]
        ReadDiff[Read Commit + Diff<br/><i>git log + git diff</i>]
        Review[Review Against 7 Criteria<br/><i>env files, purpose, scope, regressions, history...</i>]
        Decision{Decision}
        WriteReview[Write Review Notes<br/><i>append verdict to .agent-session.md</i>]

        ReadShared --> ReadDiff --> Review --> Decision
    end

    CallCV --> ReadShared

    Decision -->|APPROVED| WriteReview
    Decision -->|CONTRADICTION| WriteReview
    Decision -->|REJECTED| WriteReview

    WriteReview -->|APPROVED| Push
    WriteReview -->|CONTRADICTION / REJECTED| Revise

    Push --> RunScript
    RunScript -->|new failure| Diagnose
    Revise -->|re-commit| Commit

    classDef user fill:#166534,color:#fff,stroke:#22c55e
    classDef default fill:#1e293b,color:#e2e8f0,stroke:#334155
    style deploy fill:none,stroke:#3b82f6,stroke-width:2px,color:#60a5fa
    style validate fill:none,stroke:#a855f7,stroke-width:2px,color:#c084fc
```

### Shared Memory

```mermaid
flowchart LR
    subgraph files ["Shared Files in ~/sylva-core/"]
        Session[".agent-session.md<br/><i>session goal, fix attempts,<br/>review notes, decisions</i>"]
        Log[".code-validate-log.md<br/><i>clean audit trail of<br/>approved commits only</i>"]
    end

    Deploy([sylva-cluster-deploy]):::deploy
    Validate([code-validate]):::validate

    Deploy -->|writes session header,<br/>fix attempt entries| Session
    Deploy -.->|reads prior decisions<br/>+ reviewer feedback| Session
    Validate -->|writes review entries<br/>for all verdicts| Session
    Validate -.->|reads session goal<br/>+ fix context| Session
    Validate -->|writes approved<br/>commit entries| Log
    Validate -.->|reads commit history<br/>for contradiction check| Log

    classDef deploy fill:#1e3a5f,color:#93c5fd,stroke:#3b82f6
    classDef validate fill:#2e1065,color:#d8b4fe,stroke:#a855f7
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
ln -s ~/claude-skills/sylva-cluster-deploy ~/.cursor/skills/sylva-cluster-deploy
ln -s ~/claude-skills/code-validate ~/.cursor/skills/code-validate
```

If using Claude Code, add symlinks for Claude:

```bash
ln -s ~/claude-skills/sylva-cluster-deploy ~/.claude/sylva-cluster-deploy
ln -s ~/claude-skills/code-validate ~/.claude/code-validate
```

