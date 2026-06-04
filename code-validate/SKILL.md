---
name: code-validate
description: >-
  Validate code changes before push. Reviews commit diffs for purpose alignment,
  scope, regressions, and env file leaks. Logs approved commits.
  Use when sylva-cluster-deploy requests approval before pushing code.
disable-model-invocation: true
---

# Code Validate

Gate-keeper that reviews commits before push.

## Shared Files

| File | Purpose |
|------|---------|
| `~/sylva-core/.agent-session.md` | Shared memory — read for context, append review notes |
| `~/sylva-core/.code-validate-log.md` | Audit trail — append approved commits only |

## Workflow

### Step 1: Gather Context

1. Read `~/sylva-core/.agent-session.md` (if exists) — session goal, fix
   attempts, prior review notes. Focus on the latest entries.

2. Read `~/sylva-core/.code-validate-log.md` (if exists) — approved commit
   history for contradiction detection.

3. Read commit message and diff:
```bash
git log -1 --format='%H%n%s%n%n%B' HEAD
git diff HEAD~1..HEAD
```

4. Extract issue description from the caller's prompt.

### Step 2: Review Criteria

| # | Check | Question |
|---|-------|----------|
| 1 | **No local env files** | Commit includes `environment-values/*`, `*kubeconfig*`, `.env`? REJECT immediately. |
| 2 | **Purpose alignment** | Every changed file relates to the stated issue? |
| 3 | **Completeness** | Change fully addresses the issue? |
| 4 | **Scope limitation** | Unrelated modifications, debug leftovers? |
| 5 | **No regressions** | Could break existing units or deployment? |
| 6 | **Commit message** | Accurately describes the change? |
| 7 | **History consistency** | Conflicts with or reverts a prior fix? Repeated fix without progress? |

### Step 3: Decision

- **APPROVED** — correct, scoped, ready to push.
- **CONTRADICTION** — conflicts with prior approved fix. Include which commits,
  what conflicts, files/lines involved.
- **REJECTED** — issues unrelated to history. Include reasons and actions.

### Step 4: Update Session Context

Append to `~/sylva-core/.agent-session.md` (all verdicts, compact format):

```
## Review: <sha_short> — <subject> [APPROVED|CONTRADICTION|REJECTED]
verdict: <verdict>
notes: <one-line reasoning>
```

### Step 5: Log Commit (APPROVED only)

Append to `~/sylva-core/.code-validate-log.md`:

```
## <sha_short> — <subject> | <DATE>
issue: <one line>
changes: <one line summary>
```

### Step 6: Return Result

Final message must contain exactly one of:

```
CODE_VALIDATE_RESULT: APPROVED
COMMIT: <full_sha>
SUMMARY: <one-line>
```

```
CODE_VALIDATE_RESULT: CONTRADICTION
COMMIT: <full_sha>
CONFLICTING_COMMITS: <short SHAs>
DETAIL: <conflict description>
ACTION: Revise or re-submit with JUSTIFICATION.
```

```
CODE_VALIDATE_RESULT: REJECTED
COMMIT: <full_sha>
REASON: <why>
ACTION: <what to fix>
```

### Re-submissions with Justification

If caller includes `JUSTIFICATION:` after a CONTRADICTION:
- Clear and valid → APPROVED (note justification in log)
- Vague → REJECTED with request for specifics
