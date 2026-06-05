# Claude Skills

Cursor agent skills for Sylva infrastructure automation.

## Usage

All commands go through the `/sylva` dispatcher:

```
/sylva learn about <unit>                    — investigate what a unit does
/sylva enable <unit> on management cluster   — learn + suggest + deploy pipeline
/sylva enable <unit> on workload cluster     — same, targeting workload
/sylva disable <unit> on management cluster  — disable unit locally (no commit)
/sylva deploy management                     — redeploy management from scratch
/sylva deploy ocp workload cluster           — deploy OCP workload cluster
/sylva deploy okd workload cluster           — deploy OKD workload cluster
/sylva troubleshoot management cluster       — diagnose and fix management
/sylva troubleshoot workload cluster         — diagnose and fix workload
/sylva refresh <unit>                        — re-investigate a cached unit
/sylva what depends on <unit>                — dependency lookup from cache
```

### Environment Variables

Set these to skip env path prompts:

| Variable | Purpose | Default |
|----------|---------|---------|
| `SYLVA_MGMT_ENV` | Management cluster env values path | `environment-values/my-okd-capm3` |
| `SYLVA_WC_ENV` | Workload cluster env values path | auto-detect from command |

## Skills

### sylva (dispatcher)

Unified entry point. Parses `/sylva` commands, detects environment paths from
shell variables, and routes to the correct agent.

```
sylva/
└── SKILL.md
```

---

### learn-and-suggest

Investigate what a Sylva unit does across distributions (RKE2, OKD) and suggest OKD adaptation paths. Caches results to `unit-cache.json` for fast repeat lookups.

**Two modes:**
- **Learn only**: "what does unit X do?" — returns cached or fresh investigation
- **Learn + Suggest + Deploy**: "enable unit X on OKD" — full pipeline

```
learn-and-suggest/
└── SKILL.md
```

---

### sylva-cluster-deploy

Deploy, repair management clusters and workload clusters. Also the final step in the Learn → Suggest → Deploy pipeline. All code changes go through **code-validate** before push.

**Modes:**
- Management Redeploy — teardown + bootstrap.sh
- Management Repair — diagnose, fix, retry
- Workload Deploy — apply-workload-cluster.sh
- Workload Repair — investigate, fix, push, redeploy

```
sylva-cluster-deploy/
├── SKILL.md                  # Core: env rules, commit procedure, mode selection
├── mgmt-redeploy.md          # Management redeploy
├── mgmt-repair.md            # Management repair + monitoring + diagnosis
├── workload-deploy.md         # Workload deploy + repair
├── encountered-issues.md
├── known-issues.md
└── scripts/
    └── check-cluster-health.sh
```

---

### code-validate

Gate-keeper that reviews commits before push. Returns `APPROVED`, `CONTRADICTION`, or `REJECTED`.

```
code-validate/
└── SKILL.md
```

---

## Shared Memory

| File | Purpose | Writers |
|------|---------|---------|
| `.agent-session.md` | Compact session context — goal, fix attempts, review notes | All agents |
| `.code-validate-log.md` | Audit trail of approved commits | code-validate |
| `~/claude-skills/unit-cache.json` | Cached unit investigations + dependency graph | learn-and-suggest |

## Architecture

Three-agent pipeline for understanding, deploying, and validating Sylva units.

### Agent Pipeline

```mermaid
flowchart TD
    User([User]):::user -->|learn / adapt / deploy| LearnSuggest

    subgraph ls ["learn-and-suggest"]
        LearnSuggest[Investigate Unit]
        Cache{Cached?}
        Investigate[L1-L6 Investigation]
        UpdateCache[Update unit-cache.json]
        Suggest[Identify Blockers + Generate Paths]
        UserPick[/User Picks Option/]

        LearnSuggest --> Cache
        Cache -->|yes| ReturnCached[Return Cached]
        Cache -->|no| Investigate --> UpdateCache
        UpdateCache -->|learn only| ReturnCached
        UpdateCache -->|adapt/enable| Suggest --> UserPick
    end

    subgraph deploy ["sylva-cluster-deploy"]
        ReadDecision[Read Decision]
        Implement[Implement Changes]
        Commit[git commit]
        CallCV[Call code-validate]
        Push[git push]
        Revise[Revise / Justify]
        RunScript[Run deploy script]

        ReadDecision --> Implement --> Commit --> CallCV
    end

    subgraph validate ["code-validate"]
        ReadCtx[Read Session + Log]
        Review[Review 7 Criteria]
        Verdict{Verdict}

        ReadCtx --> Review --> Verdict
    end

    UserPick -->|auto-calls| ReadDecision
    CallCV -->|auto-calls| ReadCtx

    Verdict -->|APPROVED| Push
    Verdict -->|CONTRADICTION / REJECTED| Revise
    Push --> RunScript
    RunScript -->|new failure| Implement
    Revise -->|re-commit| Commit

    classDef user fill:#334155,color:#e2e8f0,stroke:#94a3b8
    classDef default fill:#1e293b,color:#e2e8f0,stroke:#334155
    style ls fill:none,stroke:#ef4444,stroke-width:2px,color:#f87171
    style deploy fill:none,stroke:#3b82f6,stroke-width:2px,color:#60a5fa
    style validate fill:none,stroke:#22c55e,stroke-width:2px,color:#4ade80
```

### Shared Memory Flow

```mermaid
flowchart LR
    subgraph files ["Shared Files"]
        Session[".agent-session.md"]
        Log[".code-validate-log.md"]
        UnitCache["unit-cache.json"]
    end

    LS([learn-and-suggest]):::learn
    Deploy([sylva-cluster-deploy]):::deploy
    CV([code-validate]):::validate

    LS -->|writes learn summary,<br/>adaptation decision| Session
    LS -->|writes/reads cached<br/>unit data| UnitCache
    Deploy -.->|reads decision| Session
    Deploy -->|writes fix attempts| Session
    CV -.->|reads session context| Session
    CV -->|writes review notes| Session
    CV -->|writes approved commits| Log
    CV -.->|reads commit history| Log

    classDef learn fill:#450a0a,color:#fca5a5,stroke:#ef4444
    classDef deploy fill:#1e3a5f,color:#93c5fd,stroke:#3b82f6
    classDef validate fill:#052e16,color:#86efac,stroke:#22c55e
    style files fill:none,stroke:#eab308,stroke-width:2px,color:#facc15
```

### Validation Outcomes

```mermaid
flowchart LR
    A[APPROVED]:::approved -->|log + push| Push[git push]
    C[CONTRADICTION]:::contradiction --> Choose{Deploy agent}
    Choose -->|revise| Revise[Fix code]
    Choose -->|justify| Justify[Re-submit with reason]
    R[REJECTED]:::rejected --> Fix[Reset + fix + re-commit]

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

If using Cursor, add one symlink for the dispatcher only:

```bash
ln -s ~/claude-skills/sylva ~/.cursor/skills/sylva
```

If using Claude Code, add one symlink for the dispatcher only:

```bash
ln -s ~/claude-skills/sylva ~/.claude/sylva
```

Sub-agent skills (learn-and-suggest, sylva-cluster-deploy, code-validate) do not
need symlinks. The `/sylva` dispatcher calls them by file path directly.

Optionally set environment variables in your shell profile:

```bash
export SYLVA_MGMT_ENV=environment-values/my-okd-capm3
export SYLVA_WC_ENV=environment-values/workload-clusters/okd-capm3
```
