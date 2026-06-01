# Claude Skills

Claude agent skills for infrastructure automation.

## Skills

### sylva-cluster-deploy

Deploy, repair, and redeploy Sylva OKD management clusters on bare metal (cabpoa/capm3).

**Capabilities:**
- Full redeploy from scratch (teardown + bootstrap.sh)
- Repair mode (diagnose failures, apply fixes, retry)
- Known issue catalog with tested fixes
- Health check script for quick status assessment
- Automatic retry loop until all Sylva units are ready

**Usage:** Reference this skill when working with Sylva cluster deployments using Claude
Add to the skills directory `~/.claude/claude-skills/sylva-cluster-deploy/SKILL.md` 

Or on Cursor by adding to the directory `~/.cursor/skills/claude-skills/sylva-cluster-deploy/SKILL.md`

```
sylva-cluster-deploy/
├── SKILL.md                          # Main instructions
├── known-issues.md                   # Catalog of known issues and fixes
└── scripts/
    └── check-cluster-health.sh       # Cluster health check script
```
