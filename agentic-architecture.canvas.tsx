import { useState, type CSSProperties } from "react";
import {
  computeDAGLayout,
  Stack,
  Row,
  H1,
  H2,
  H3,
  Text,
  Card,
  CardHeader,
  CardBody,
  Pill,
  Divider,
  Grid,
  Table,
  Callout,
  useHostTheme,
} from "cursor/canvas";

type NodeMeta = {
  label: string;
  detail?: string;
  agent?: "deploy" | "validate" | "shared" | "user";
  shape?: "decision";
};

const NODE_META: Record<string, NodeMeta> = {
  user:        { label: "User", detail: "Triggers deploy / repair / upgrade", agent: "user" },
  read_env:    { label: "Read Environment", detail: "Extract cluster name, node IP, disk config", agent: "deploy" },
  init_session:{ label: "Init Session Context", detail: "Write session goal, mode, cluster to .agent-session.md", agent: "deploy" },
  diagnose:    { label: "Diagnose / Fix", detail: "Monitor cluster, trace failures, edit code", agent: "deploy" },
  write_ctx:   { label: "Write Fix Attempt", detail: "Append problem + approach to .agent-session.md", agent: "deploy" },
  commit:      { label: "git add + commit", detail: "Stage and commit locally (no push)", agent: "deploy" },
  call_cv:     { label: "Call Code Validate", detail: "Launch sub-agent via Task tool", agent: "deploy" },
  read_shared: { label: "Read Shared Memory", detail: "Read .agent-session.md + .code-validate-log.md", agent: "validate" },
  read_diff:   { label: "Read Commit + Diff", detail: "git log + git diff HEAD~1..HEAD", agent: "validate" },
  review:      { label: "Review (6 Criteria)", detail: "Purpose, completeness, scope, regressions, message, history", agent: "validate" },
  decision:    { label: "Decision", agent: "validate", shape: "decision" },
  approved:    { label: "APPROVED", detail: "Log to .code-validate-log.md", agent: "validate" },
  contradiction:{ label: "CONTRADICTION", detail: "Return conflicting commits + detail", agent: "validate" },
  rejected:    { label: "REJECTED", detail: "Return reason + action needed", agent: "validate" },
  write_review:{ label: "Write Review Notes", detail: "Append verdict + reasoning to .agent-session.md", agent: "validate" },
  push:        { label: "git push", detail: "Push approved change to origin", agent: "deploy" },
  revise:      { label: "Revise or Justify", detail: "Fix code or re-submit with JUSTIFICATION", agent: "deploy" },
  run_script:  { label: "Run bootstrap / apply", detail: "Deploy changes to cluster via tmux", agent: "deploy" },
};

const EDGES = [
  { from: "user", to: "read_env" },
  { from: "read_env", to: "init_session" },
  { from: "init_session", to: "diagnose" },
  { from: "diagnose", to: "write_ctx" },
  { from: "write_ctx", to: "commit" },
  { from: "commit", to: "call_cv" },
  { from: "call_cv", to: "read_shared" },
  { from: "read_shared", to: "read_diff" },
  { from: "read_diff", to: "review" },
  { from: "review", to: "decision" },
  { from: "decision", to: "approved" },
  { from: "decision", to: "contradiction" },
  { from: "decision", to: "rejected" },
  { from: "approved", to: "write_review" },
  { from: "contradiction", to: "write_review" },
  { from: "rejected", to: "write_review" },
  { from: "write_review", to: "push" },
  { from: "write_review", to: "revise" },
  { from: "push", to: "run_script" },
  { from: "run_script", to: "diagnose" },
  { from: "revise", to: "commit" },
];

const NODE_W = 190;
const NODE_H = 52;

function agentColor(agent: string | undefined, theme: ReturnType<typeof useHostTheme>) {
  switch (agent) {
    case "deploy":   return { bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.5)", text: theme.text.primary };
    case "validate": return { bg: "rgba(168,85,247,0.12)", border: "rgba(168,85,247,0.5)", text: theme.text.primary };
    case "shared":   return { bg: "rgba(234,179,8,0.12)",  border: "rgba(234,179,8,0.5)",  text: theme.text.primary };
    case "user":     return { bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.5)",  text: theme.text.primary };
    default:         return { bg: theme.fill.tertiary,      border: theme.stroke.secondary,  text: theme.text.primary };
  }
}

function verdictColor(label: string) {
  if (label === "APPROVED") return "rgba(34,197,94,0.5)";
  if (label === "CONTRADICTION") return "rgba(234,179,8,0.5)";
  if (label === "REJECTED") return "rgba(239,68,68,0.5)";
  return undefined;
}

function DAGDiagram() {
  const theme = useHostTheme();
  const [hovered, setHovered] = useState<string | null>(null);

  const nodes = Object.keys(NODE_META).map((id) => ({ id }));
  const layout = computeDAGLayout({
    nodes,
    edges: EDGES,
    direction: "vertical",
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    rankGap: 56,
    nodeGap: 28,
    padding: 32,
  });

  return (
    <div style={{ position: "relative", width: layout.width, height: layout.height, margin: "0 auto" }}>
      <svg
        width={layout.width}
        height={layout.height}
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
      >
        {layout.edges.map((e, i) => {
          const isBack = e.isBackEdge;
          const isVerdict = e.from === "decision" || e.from === "write_review";
          const stroke = isBack
            ? theme.stroke.tertiary
            : isVerdict
              ? theme.text.secondary
              : theme.stroke.secondary;
          return (
            <line
              key={i}
              x1={e.sourceX}
              y1={e.sourceY}
              x2={e.targetX}
              y2={e.targetY}
              stroke={stroke}
              strokeWidth={isBack ? 1 : 1.5}
              strokeDasharray={isBack ? "6,4" : undefined}
              markerEnd="url(#arrow)"
            />
          );
        })}
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.stroke.secondary} />
          </marker>
        </defs>
      </svg>

      {layout.nodes.map((n) => {
        const meta = NODE_META[n.id];
        const colors = agentColor(meta.agent, theme);
        const vColor = verdictColor(meta.label);
        const borderColor = vColor || colors.border;
        const isHovered = hovered === n.id;
        const isDiamond = meta.shape === "decision";

        const boxStyle: CSSProperties = {
          position: "absolute",
          left: n.x,
          top: n.y,
          width: NODE_W,
          height: NODE_H,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: isHovered ? colors.bg.replace("0.12", "0.22") : colors.bg,
          border: `1.5px solid ${borderColor}`,
          borderRadius: isDiamond ? 2 : 6,
          cursor: "default",
          transform: isDiamond ? "rotate(0deg)" : undefined,
          transition: "background 0.15s",
          padding: "4px 8px",
          overflow: "hidden",
        };

        return (
          <div
            key={n.id}
            style={boxStyle}
            onMouseEnter={() => setHovered(n.id)}
            onMouseLeave={() => setHovered(null)}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: colors.text,
                textAlign: "center",
                lineHeight: "14px",
                whiteSpace: "nowrap",
              }}
            >
              {meta.label}
            </span>
            {meta.detail && isHovered && (
              <span
                style={{
                  fontSize: 9,
                  color: theme.text.tertiary,
                  textAlign: "center",
                  lineHeight: "12px",
                  marginTop: 2,
                }}
              >
                {meta.detail}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AgenticArchitecture() {
  const theme = useHostTheme();

  return (
    <Stack gap={24} style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <H1>Sylva Agentic Architecture</H1>
      <Text tone="secondary">
        Two-agent system for deploying and validating code changes on Sylva OKD
        management clusters. The deploy agent fixes issues and the validate agent
        gates every push.
      </Text>

      <Row gap={12} wrap>
        <Pill tone="info" active>Deploy Agent</Pill>
        <Pill tone="renamed" active>Validate Agent</Pill>
        <Pill tone="success" active>User</Pill>
      </Row>

      <Divider />

      <H2>Workflow</H2>
      <Text tone="secondary" size="small">
        Hover over nodes to see details. Dashed lines indicate retry loops.
      </Text>

      <div style={{ overflowX: "auto" }}>
        <DAGDiagram />
      </div>

      <Divider />

      <H2>Agent Responsibilities</H2>
      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill tone="info" size="sm" active>deploy</Pill>}>
            sylva-cluster-deploy
          </CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text size="small">Reads cluster environment and deploys via bootstrap.sh or apply.sh. Diagnoses failures, applies code fixes, commits locally, and calls code-validate before pushing.</Text>
              <Text size="small" weight="semibold">Writes to shared memory:</Text>
              <Text size="small" tone="secondary">Session goal, mode, cluster info, and fix attempt context (problem, approach, files changed) before each commit.</Text>
            </Stack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader trailing={<Pill tone="renamed" size="sm" active>validate</Pill>}>
            code-validate
          </CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text size="small">Reviews each commit against 6 criteria. Returns APPROVED, CONTRADICTION, or REJECTED. Logs approved commits to the audit trail.</Text>
              <Text size="small" weight="semibold">Writes to shared memory:</Text>
              <Text size="small" tone="secondary">Review notes with verdict and reasoning after every review (all verdicts, not just approvals).</Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <Divider />

      <H2>Shared Memory</H2>
      <Table
        headers={["File", "Purpose", "Deploy writes", "Validate writes"]}
        rows={[
          [
            ".agent-session.md",
            "Session goal, fix attempts, review notes, decisions",
            "Session header, fix attempt entries",
            "Review entries (all verdicts with reasoning)",
          ],
          [
            ".code-validate-log.md",
            "Clean audit trail of approved commits",
            "\u2014",
            "Approved commit entries only",
          ],
        ]}
        striped
      />

      <Divider />

      <H2>Decision Outcomes</H2>
      <Grid columns={3} gap={16}>
        <Card>
          <CardHeader trailing={<Pill tone="success" size="sm" active>push</Pill>}>
            APPROVED
          </CardHeader>
          <CardBody>
            <Text size="small">Change is correct and scoped. Logged to audit trail. Deploy agent pushes and runs bootstrap/apply.</Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill tone="warning" size="sm" active>revise or justify</Pill>}>
            CONTRADICTION
          </CardHeader>
          <CardBody>
            <Text size="small">Conflicts with a prior fix. Deploy agent either revises the code or re-submits with a JUSTIFICATION explaining why the contradiction is necessary.</Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill tone="deleted" size="sm" active>fix and retry</Pill>}>
            REJECTED
          </CardHeader>
          <CardBody>
            <Text size="small">Change has issues (scope creep, incomplete, regression risk). Deploy agent resets the commit, fixes, and re-submits.</Text>
          </CardBody>
        </Card>
      </Grid>

      <Divider />

      <H2>Review Criteria</H2>
      <Table
        headers={["#", "Check", "Question"]}
        rows={[
          ["1", "Purpose alignment", "Does every changed file relate to the stated issue?"],
          ["2", "Completeness", "Does the change fully address the issue?"],
          ["3", "Scope limitation", "Are there unrelated modifications (scope creep, debug leftovers)?"],
          ["4", "No regressions", "Could the change break an existing unit or deployment step?"],
          ["5", "Commit message", "Does the message accurately describe the change?"],
          ["6", "History consistency", "Does this conflict with or revert a previous fix? Repeated fix without progress?"],
        ]}
        striped
      />

      <Callout tone="info" title="Retry loop">
        After a successful push and script run, the deploy agent resumes monitoring. If a new failure appears, it loops back through diagnosis, fix, commit, and validation again until all units report ready.
      </Callout>
    </Stack>
  );
}
