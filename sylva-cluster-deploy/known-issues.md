# Known Limitations — Sylva Cluster Deploy Agent Skill

## Shell Environment

- **Shell can become unresponsive** during long-running operations. The agent cannot monitor tmux sessions when this happens. The deployment continues independently in tmux — the agent resumes monitoring when the shell recovers.
- **tmux capture-pane** is the primary way the agent reads deployment output. If tmux is unavailable, the agent falls back to reading log files (`bootstrap.log`, `apply.log`), which may also be inaccessible during shell outages.

## Monitoring Gaps

- **No continuous background watch**: The agent polls at intervals (30s–3min) rather than streaming output. Short-lived errors between polls may be missed.
- **Clock skew detection is reactive**: The agent only discovers bastion/node clock drift when `oc` commands fail with TLS errors, not proactively.
- **ACI events require the BMH to be provisioning**: The agent cannot poll assisted-installer events until the BMH reaches `provisioning` state.

## Unit Enablement

- **`enabled_conditions` are not auto-analyzed**: When enabling a unit for cabpoa, the agent does not automatically scan all provider-conditional logic (health checks, ConfigMap name patches, ClusterIP assignments). It discovers these issues reactively during apply failures.
- **Dependency cycles**: The agent cannot predict dependency cycles (e.g. health check waiting for a resource created by a dependent unit) before running `apply.sh`. It diagnoses them from failure output.

## Code Changes

- **No dry-run**: The agent cannot preview what `apply.sh` will do before running it. It commits, pushes, and runs — then reacts to failures.
- **Chart template validation**: The agent does not validate Helm template syntax before committing. Invalid Go templates are caught at `apply.sh` runtime.
- **`git add -A`**: The agent uses `git add -A` which may pick up untracked files (logs, scripts) alongside intentional changes. Review commits carefully.

## Scope

- **Management cluster only**: This skill targets the management cluster (`environment-values/my-okd-capm3`). Workload cluster operations are not covered.
- **Single environment**: The skill reads from one hardcoded environment path. Multi-environment workflows require manual path overrides.
