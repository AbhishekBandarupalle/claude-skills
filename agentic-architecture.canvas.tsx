import { useState } from "react";
import {
  computeDAGLayout,
  Stack,
  Row,
  H1,
  H2,
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
  agent?: "learn" | "suggest" | "deploy" | "validate" | "user";
};

const NODE_META: Record<string, NodeMeta> = {
  user:           { label: "User", detail: "Asks about a unit or requests enable on OKD", agent: "user" },
  investigate:    { label: "Investigate Unit", detail: "Definition, resources, deps, Kyverno, RKE2 vs OKD", agent: "learn" },
  write_summary:  { label: "Write Summary", detail: "Append full analysis to .agent-session.md", agent: "learn" },
  read_summary:   { label: "Read Learn Summary", detail: "From .agent-session.md", agent: "suggest" },
  blockers:       { label: "Identify Blockers", detail: "SCCs, CNI, images, APIs, MCP reboots...", agent: "suggest" },
  gen_paths:      { label: "Generate Paths", detail: "A: add SCCs  B: OKD-native  C: disable  D: hybrid", agent: "suggest" },
  user_pick:      { label: "User Picks Option", detail: "User selects adaptation path", agent: "user" },
  record:         { label: "Record Decision", detail: "Write chosen path to .agent-session.md", agent: "suggest" },
  read_decision:  { label: "Read Decision", detail: "From .agent-session.md", agent: "deploy" },
  implement:      { label: "Implement Changes", detail: "Edit charts, kustomize, SCCs, values...", agent: "deploy" },
  write_attempt:  { label: "Write Fix Attempt", detail: "Append problem + approach to .agent-session.md", agent: "deploy" },
  commit:         { label: "git add + commit", detail: "Stage codebase files only, no env files", agent: "deploy" },
  call_cv:        { label: "Call code-validate", detail: "Launch validation sub-agent", agent: "deploy" },
  read_all:       { label: "Read Shared Memory", detail: ".agent-session.md + .code-validate-log.md", agent: "validate" },
  review_diff:    { label: "Review (7 Criteria)", detail: "Env files, purpose, scope, regressions, history...", agent: "validate" },
  decision:       { label: "Verdict", agent: "validate" },
  write_review:   { label: "Write Review Notes", detail: "Append verdict to .agent-session.md", agent: "validate" },
  push:           { label: "git push", detail: "Push approved change to origin", agent: "deploy" },
  revise:         { label: "Revise or Justify", detail: "Fix code or re-submit with JUSTIFICATION", agent: "deploy" },
  run_script:     { label: "Run apply / bootstrap", detail: "Deploy changes to cluster via tmux", agent: "deploy" },
};

const EDGES = [
  { from: "user", to: "investigate" },
  { from: "investigate", to: "write_summary" },
  { from: "write_summary", to: "read_summary" },
  { from: "read_summary", to: "blockers" },
  { from: "blockers", to: "gen_paths" },
  { from: "gen_paths", to: "user_pick" },
  { from: "user_pick", to: "record" },
  { from: "record", to: "read_decision" },
  { from: "read_decision", to: "implement" },
  { from: "implement", to: "write_attempt" },
  { from: "write_attempt", to: "commit" },
  { from: "commit", to: "call_cv" },
  { from: "call_cv", to: "read_all" },
  { from: "read_all", to: "review_diff" },
  { from: "review_diff", to: "decision" },
  { from: "decision", to: "write_review" },
  { from: "write_review", to: "push" },
  { from: "write_review", to: "revise" },
  { from: "push", to: "run_script" },
  { from: "run_script", to: "implement" },
  { from: "revise", to: "commit" },
];

const NODE_W = 185;
const NODE_H = 50;

function agentColor(agent: string | undefined) {
  switch (agent) {
    case "learn":    return { bg: "rgba(239,68,68,0.10)",  border: "rgba(239,68,68,0.55)" };
    case "suggest":  return { bg: "rgba(234,179,8,0.10)",  border: "rgba(234,179,8,0.55)" };
    case "deploy":   return { bg: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.55)" };
    case "validate": return { bg: "rgba(34,197,94,0.10)",  border: "rgba(34,197,94,0.55)" };
    case "user":     return { bg: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.55)" };
    default:         return { bg: "rgba(100,100,100,0.08)", border: "rgba(100,100,100,0.3)" };
  }
}

function agentPillTone(agent: string): "info" | "warning" | "renamed" | "success" | "neutral" {
  switch (agent) {
    case "learn": return "info";
    case "suggest": return "warning";
    case "deploy": return "renamed";
    case "validate": return "neutral";
    case "user": return "success";
    default: return "neutral";
  }
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
    rankGap: 52,
    nodeGap: 24,
    padding: 32,
  });

  return (
    <div style={{ position: "relative", width: layout.width, height: layout.height, margin: "0 auto" }}>
      <svg
        width={layout.width}
        height={layout.height}
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.stroke.secondary} />
          </marker>
        </defs>
        {layout.edges.map((e, i) => (
          <line
            key={i}
            x1={e.sourceX} y1={e.sourceY}
            x2={e.targetX} y2={e.targetY}
            stroke={e.isBackEdge ? theme.stroke.tertiary : theme.stroke.secondary}
            strokeWidth={e.isBackEdge ? 1 : 1.5}
            strokeDasharray={e.isBackEdge ? "6,4" : undefined}
            markerEnd="url(#arrow)"
          />
        ))}
      </svg>

      {layout.nodes.map((n) => {
        const meta = NODE_META[n.id];
        const colors = agentColor(meta.agent);
        const isHovered = hovered === n.id;

        return (
          <div
            key={n.id}
            style={{
              position: "absolute",
              left: n.x, top: n.y,
              width: NODE_W, height: NODE_H,
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              background: isHovered ? colors.bg.replace("0.10", "0.22") : colors.bg,
              border: `1.5px solid ${colors.border}`,
              borderRadius: 6,
              cursor: "default",
              padding: "4px 8px",
              overflow: "hidden",
              transition: "background 0.15s",
            }}
            onMouseEnter={() => setHovered(n.id)}
            onMouseLeave={() => setHovered(null)}
          >
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: theme.text.primary,
              textAlign: "center", lineHeight: "14px",
              whiteSpace: "nowrap",
            }}>
              {meta.label}
            </span>
            {meta.detail && isHovered && (
              <span style={{
                fontSize: 9, color: theme.text.tertiary,
                textAlign: "center", lineHeight: "12px", marginTop: 2,
              }}>
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
    <Stack gap={24} style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <H1>Sylva Agentic Architecture</H1>
      <Text tone="secondary">
        Four-agent pipeline for understanding, adapting, deploying, and validating
        Sylva units on OKD clusters.
      </Text>

      <Row gap={10} wrap>
        <Pill tone="deleted" active>Learn</Pill>
        <Pill tone="warning" active>Suggest</Pill>
        <Pill tone="info" active>Deploy</Pill>
        <Pill tone="success" active>Validate</Pill>
        <Pill active>User</Pill>
      </Row>

      <Divider />

      <H2>Agent Pipeline</H2>
      <Text tone="secondary" size="small">
        Hover over nodes for details. Dashed lines are retry loops.
        Each agent auto-calls the next in the chain.
      </Text>

      <div style={{ overflowX: "auto" }}>
        <DAGDiagram />
      </div>

      <Divider />

      <H2>Agents</H2>
      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill tone="deleted" size="sm" active>learn</Pill>}>
            learn-sylva-units
          </CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text size="small">Investigates what a unit does across RKE2 and OKD — definition, resources, dependencies, Kyverno policies, cross-distribution gaps.</Text>
              <Text size="small" weight="semibold">Writes:</Text>
              <Text size="small" tone="secondary">Unit summary to .agent-session.md, then auto-calls suggest-adaptation.</Text>
            </Stack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader trailing={<Pill tone="warning" size="sm" active>suggest</Pill>}>
            suggest-adaptation
          </CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text size="small">Identifies OKD blockers and generates adaptation paths (add SCCs, use OpenShift-native, hybrid, disable). User picks one.</Text>
              <Text size="small" weight="semibold">Writes:</Text>
              <Text size="small" tone="secondary">Adaptation decision to .agent-session.md, then auto-calls sylva-cluster-deploy.</Text>
            </Stack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader trailing={<Pill tone="info" size="sm" active>deploy</Pill>}>
            sylva-cluster-deploy
          </CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text size="small">Implements the chosen adaptation. Edits charts, kustomize-units, SCCs. Commits and calls code-validate before pushing. Runs apply.sh/bootstrap.sh.</Text>
              <Text size="small" weight="semibold">Writes:</Text>
              <Text size="small" tone="secondary">Fix attempt entries to .agent-session.md. Never commits env files.</Text>
            </Stack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader trailing={<Pill tone="success" size="sm" active>validate</Pill>}>
            code-validate
          </CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text size="small">Reviews each commit against 7 criteria. Returns APPROVED, CONTRADICTION, or REJECTED. Logs approved commits to audit trail.</Text>
              <Text size="small" weight="semibold">Writes:</Text>
              <Text size="small" tone="secondary">Review notes to .agent-session.md (all verdicts). Approved entries to .code-validate-log.md.</Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <Divider />

      <H2>Shared Memory</H2>
      <Table
        headers={["File", "Purpose", "Writers", "Readers"]}
        rows={[
          [".agent-session.md", "Learn summaries, adaptation decisions, fix attempts, review notes", "All agents", "All agents"],
          [".code-validate-log.md", "Clean audit trail of approved commits", "code-validate", "code-validate, deploy"],
        ]}
        striped
      />

      <Divider />

      <H2>Validation Outcomes</H2>
      <Grid columns={3} gap={16}>
        <Card>
          <CardHeader trailing={<Pill tone="success" size="sm" active>push</Pill>}>
            APPROVED
          </CardHeader>
          <CardBody>
            <Text size="small">Change is correct and scoped. Logged to audit trail. Deploy pushes and runs the script.</Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill tone="warning" size="sm" active>revise / justify</Pill>}>
            CONTRADICTION
          </CardHeader>
          <CardBody>
            <Text size="small">Conflicts with a prior fix. Deploy either revises the code or re-submits with a JUSTIFICATION.</Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill tone="deleted" size="sm" active>fix + retry</Pill>}>
            REJECTED
          </CardHeader>
          <CardBody>
            <Text size="small">Change has issues. Deploy resets the commit, fixes, and re-submits.</Text>
          </CardBody>
        </Card>
      </Grid>

      <Divider />

      <H2>Review Criteria</H2>
      <Table
        headers={["#", "Check", "Question"]}
        rows={[
          ["1", "No local env files", "Does the commit include environment-values/*, *kubeconfig*, or .env?"],
          ["2", "Purpose alignment", "Does every changed file relate to the stated issue?"],
          ["3", "Completeness", "Does the change fully address the issue?"],
          ["4", "Scope limitation", "Any unrelated modifications (scope creep, debug leftovers)?"],
          ["5", "No regressions", "Could the change break an existing unit or deployment step?"],
          ["6", "Commit message", "Does the message accurately describe the change?"],
          ["7", "History consistency", "Conflicts with or reverts a previous fix?"],
        ]}
        striped
      />

      <Callout tone="info" title="Automated chain">
        Each agent auto-calls the next: Learn → Suggest → Deploy → Validate.
        The only manual step is the user picking an adaptation path in Suggest.
        After that, Deploy implements, validates, and pushes autonomously.
      </Callout>
    </Stack>
  );
}
