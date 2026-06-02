---
name: code-validate
description: >-
  Validate code changes before they are pushed to the repository.
  Reviews the issue context and staged/committed changes to verify the fix achieves
  its purpose and is limited in scope. Logs approved commits to a persistent log file.
  Use when the sylva-cluster-deploy agent (or any agent) requests approval before
  pushing code, or when the user asks to validate, review, or approve pending changes.
disable-model-invocation: true
---

# Code Validate

Gate-keeper agent that reviews code changes before they are pushed to the repository.

## Shared Files

| File | Purpose | Who writes | Who reads |
|------|---------|------------|-----------|
| `~/sylva-core/.code-validate-log.md` | Clean audit trail of approved commits | code-validate | both |
| `~/sylva-core/.agent-session.md` | Shared memory — session goal, decisions, rejected approaches, review notes | both | both |

## When This Skill Is Called

The sylva-cluster-deploy agent (or parent agent) calls this skill as a sub-agent **after creating a git commit but before pushing**. The caller provides:

- **Issue description**: What problem the change is meant to solve
- **Commit SHA**: The commit to review (defaults to `HEAD`)

## Validation Workflow

### Step 1: Gather Context

1. **Read the shared session context** at `~/sylva-core/.agent-session.md` (if it exists).
   This is the shared memory between you and the deploy agent. It contains:
   - The session goal (what the deploy agent is trying to achieve overall)
   - Decisions made and their reasoning
   - Approaches that were tried and rejected (and why)
   - Your own prior review notes from earlier validations
   Use this to understand the full picture before reviewing the current commit.

2. **Read the commit history log** at `~/sylva-core/.code-validate-log.md` (if it exists).
   This is the clean audit trail of approved commits — what issues were solved,
   what files were touched, and what was changed. Use this to:
   - Detect if the current change contradicts or reverts a previous fix
   - Spot repeated fixes for the same issue (may indicate the root cause wasn't addressed)
   - Identify scope drift across the session (many unrelated changes accumulating)

3. Read the commit message:

```bash
git log -1 --format='%H%n%s%n%n%B' HEAD
```

4. Read the full diff of the commit:

```bash
git diff HEAD~1..HEAD
```

5. Receive or extract the **issue description** from the caller's prompt.

### Step 2: Review Criteria

Evaluate the change against these criteria:

| # | Check | Question |
|---|-------|----------|
| 1 | **Purpose alignment** | Does every changed file directly relate to the stated issue? |
| 2 | **Completeness** | Does the change fully address the issue, or is something missing? |
| 3 | **Scope limitation** | Are there modifications unrelated to the issue (scope creep, accidental edits, debug leftovers)? |
| 4 | **No regressions** | Could the change break an existing unit, dependency, or deployment step? |
| 5 | **Commit message quality** | Does the commit message accurately describe the change? |
| 6 | **History consistency** | Based on the log, does this change conflict with or revert a previous fix? Is the same issue being fixed repeatedly without progress? |

### Step 3: Decision

Based on the review, return one of:

- **APPROVED** — Change is correct, scoped, and ready to push.
- **CONTRADICTION** — The change conflicts with or reverts a previously approved fix.
  Include: which prior commit(s) it contradicts, what the conflict is, and the
  specific lines/files involved. The calling agent will either revise the change
  or re-submit with a justification explaining why the contradiction is necessary.
- **REJECTED** — Change has issues unrelated to history conflicts. Include specific
  reasons and what needs to change.

### Step 4: Update Shared Session Context (all verdicts)

Append a review entry to `~/sylva-core/.agent-session.md` **regardless of verdict**.
Create the file if it does not exist. This is the shared memory — both agents use it
to understand the full history of reviews, not just approvals.

```markdown
### Review: `<sha_short>` — <commit_subject> [<APPROVED|CONTRADICTION|REJECTED>]
<DATE_TIME>

- **Issue**: <one-line issue summary>
- **Verdict**: <verdict>
- **Notes**: <your reasoning — why you approved, what the contradiction was, or why you rejected>
```

### Step 5: Log the Commit (on APPROVED only)

Append an entry to the commit log at `~/sylva-core/.code-validate-log.md`.

Create the file if it does not exist. This is the clean audit trail — only approved
commits appear here.

```markdown
## <SHORT_DATE_TIME>

- **Commit**: `<sha_short>` — <commit_subject>
- **Issue**: <one-line issue summary>
- **Changes**: <2-3 sentence summary of what was changed and why>
- **Verdict**: APPROVED
```

Example:

```markdown
## 2026-06-02 11:45

- **Commit**: `a1b2c3d` — fix(scc): add metallb-speaker to privileged SCC
- **Issue**: metallb-speaker pods failing with FailedCreate due to missing SCC permissions
- **Changes**: Added metallb-system namespace and metallb-speaker service account to the privileged SCC in kustomize-units/scc/. This allows the speaker DaemonSet pods to use hostNetwork and hostPort as required.
- **Verdict**: APPROVED
```

### Step 6: Return Result to Caller

Return a structured response the calling agent can parse:

```
CODE_VALIDATE_RESULT: APPROVED
```

or

```
CODE_VALIDATE_RESULT: REJECTED
REASON: <specific reason>
ACTION: <what the caller should fix before re-submitting>
```

### Handling Re-submissions with Justification

When the calling agent re-submits a commit after a `CONTRADICTION` verdict, the
caller's prompt will include a `JUSTIFICATION:` field explaining why the
contradictory change is necessary. Evaluate the justification:

- If the justification is clear and valid (e.g. the earlier fix was wrong, requirements
  changed, or the revert is intentional) → **APPROVED**. Log the entry with
  the justification noted in the Changes summary.
- If the justification is vague or unconvincing → **REJECTED** with a request
  for a more specific explanation.

## Response Format for the Calling Agent

When invoked as a sub-agent, the **final message** must contain exactly one of:

```
CODE_VALIDATE_RESULT: APPROVED
COMMIT: <full_sha>
SUMMARY: <one-line summary>
```

```
CODE_VALIDATE_RESULT: CONTRADICTION
COMMIT: <full_sha>
CONFLICTING_COMMITS: <short SHAs of prior commits this contradicts>
DETAIL: <what the conflict is and which files/lines are involved>
ACTION: Either revise the change to avoid the conflict, or re-submit with JUSTIFICATION explaining why this contradiction is necessary.
```

```
CODE_VALIDATE_RESULT: REJECTED
COMMIT: <full_sha>
REASON: <why it failed>
ACTION: <what to fix>
```

The calling agent parses `CODE_VALIDATE_RESULT:` to decide whether to push, revise, or re-submit with justification.
