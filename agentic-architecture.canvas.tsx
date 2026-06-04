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
  agent?: "learn" | "deploy" | "validate" | "user";
};

const NODE_META: Record<string, NodeMeta> = {
  user:           { label: "User", detail: "Learn / adapt / deploy a unit", agent: "user" },
  check_cache:    { label: "Check Cache", detail: "Read unit-cache.json for cached data", agent: "learn" },
  investigate:    { label: "Investigate Unit", detail: "L1-L6: definition, resources, deps, policies", agent: "learn" },
  update_cache:   { label: "Update Cache", detail: "Write to unit-cache.json + dependency graph", agent: "learn" },
  blockers:       { label: "Identify Blockers", detail: "SCCs, CNI, images, APIs for OKD", agent: "learn" },
  gen_paths:      { label: "Generate Paths", detail: "A: add SCCs  B: OKD-native  C: disable  D: hybrid", agent: "learn" },
  user_pick:      { label: "User Picks Option", detail: "Select adaptation path", agent: "user" },
  read_decision:  { label: "Read Decision", detail: "From .agent-session.md", agent: "deploy" },
  implement:      { label: "Implement Changes", detail: "Edit charts, kustomize, SCCs...", agent: "deploy" },
  commit:         { label: "git commit", detail: "Stage codebase files only, no env files", agent: "deploy" },
  call_cv:        { label: "Call code-validate", detail: "Launch validation sub-agent", agent: "deploy" },
  read_ctx:       { label: "Read Session + Log", detail: ".agent-session.md + .code-validate-log.md", agent: "validate" },
  review:         { label: "Review 7 Criteria", detail: "Env files, purpose, scope, regressions, history", agent: "validate" },
  verdict:        { label: "Verdict", agent: "validate" },
  push:           { label: "git push", detail: "Push approved change", agent: "deploy" },
  revise:         { label: "Revise / Justify", detail: "Fix or re-submit with justification", agent: "deploy" },
  run_script:     { label: "Run Deploy Script", detail: "bootstrap.sh / apply.sh / apply-workload-cluster.sh", agent: "deploy" },
};

const EDGES = [
  { from: "user", to: "check_cache" },
  { from: "check_cache", to: "investigate" },
  { from: "investigate", to: "update_cache" },
  { from: "update_cache", to: "blockers" },
  { from: "blockers", to: "gen_paths" },
  { from: "gen_paths", to: "user_pick" },
  { from: "user_pick", to: "read_decision" },
  { from: "read_decision", to: "implement" },
  { from: "implement", to: "commit" },
  { from: "commit", to: "call_cv" },
  { from: "call_cv", to: "read_ctx" },
  { from: "read_ctx", to: "review" },
  { from: "review", to: "verdict" },
  { from: "verdict", to: "push" },
  { from: "verdict", to: "revise" },
  { from: "push", to: "run_script" },
  { from: "run_script", to: "implement" },
  { from: "revise", to: "commit" },
];

const NODE_W = 180;
const NODE_H = 48;

function agentColor(agent: string | undefined) {
  switch (agent) {
    case "learn":    return { bg: "rgba(239,68,68,0.10)",  border: "rgba(239,68,68,0.55)" };
    case "deploy":   return { bg: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.55)" };
    case "validate": return { bg: "rgba(34,197,94,0.10)",  border: "rgba(34,197,94,0.55)" };
    case "user":     return { bg: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.55)" };
    default:         return { bg: "rgba(100,100,100,0.08)", border: "rgba(100,100,100,0.3)" };
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
    rankGap: 48,
    nodeGap: 22,
    padding: 28,
  });

  return (
    <div style={{ position: "relative", width: layout.width, height: layout.height, margin: "0 auto" }}>
      <svg width={layout.width} height={layout.height} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.stroke.secondary} />
          </marker>
        </defs>
        {layout.edges.map((e, i) => (
          <line key={i} x1={e.sourceX} y1={e.sourceY} x2={e.targetX} y2={e.targetY}
            stroke={e.isBackEdge ? theme.stroke.tertiary : theme.stroke.secondary}
            strokeWidth={e.isBackEdge ? 1 : 1.5}
            strokeDasharray={e.isBackEdge ? "6,4" : undefined}
            markerEnd="url(#arrow)" />
        ))}
      </svg>
      {layout.nodes.map((n) => {
        const meta = NODE_META[n.id];
        const colors = agentColor(meta.agent);
        const isHovered = hovered === n.id;
        return (
          <div key={n.id}
            style={{
              position: "absolute", left: n.x, top: n.y, width: NODE_W, height: NODE_H,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              background: isHovered ? colors.bg.replace("0.10", "0.22") : colors.bg,
              border: `1.5px solid ${colors.border}`, borderRadius: 6,
              cursor: "default", padding: "4px 8px", overflow: "hidden", transition: "background 0.15s",
            }}
            onMouseEnter={() => setHovered(n.id)} onMouseLeave={() => setHovered(null)}>
            <span style={{ fontSize: 11, fontWeight: 600, color: theme.text.primary, textAlign: "center", lineHeight: "14px", whiteSpace: "nowrap" }}>
              {meta.label}
            </span>
            {meta.detail && isHovered && (
              <span style={{ fontSize: 9, color: theme.text.tertiary, textAlign: "center", lineHeight: "12px", marginTop: 2 }}>
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
  return (
    <Stack gap={24} style={{ maxWidth: 920, margin: "0 auto", padding: 24 }}>
      <H1>Sylva Agentic Architecture</H1>
      <Text tone="secondary">Three-agent pipeline: Learn + Suggest, Deploy, Validate. Optimized for minimal token usage with cached lookups and on-demand mode loading.</Text>

      <Row gap={10} wrap>
        <Pill tone="deleted" active>Learn + Suggest</Pill>
        <Pill tone="info" active>Deploy</Pill>
        <Pill tone="success" active>Validate</Pill>
      </Row>

      <Divider />
      <H2>Pipeline</H2>
      <Text tone="secondary" size="small">Hover nodes for details. Dashed lines are retry loops.</Text>
      <div style={{ overflowX: "auto" }}><DAGDiagram /></div>

      <Divider />
      <H2>Agents</H2>
      <Grid columns={3} gap={16}>
        <Card>
          <CardHeader trailing={<Pill tone="deleted" size="sm" active>learn</Pill>}>learn-and-suggest</CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text size="small">Investigates units across RKE2/OKD. Caches results for instant repeat lookups. Suggests adaptation paths when adapting.</Text>
              <Text size="small" weight="semibold">Cache:</Text>
              <Text size="small" tone="secondary">unit-cache.json with dependency graph</Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill tone="info" size="sm" active>deploy</Pill>}>sylva-cluster-deploy</CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text size="small">Implements changes. Loads only the mode file needed: mgmt-redeploy, mgmt-repair, or workload-deploy.</Text>
              <Text size="small" weight="semibold">Scripts:</Text>
              <Text size="small" tone="secondary">bootstrap.sh, apply.sh, apply-workload-cluster.sh</Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill tone="success" size="sm" active>validate</Pill>}>code-validate</CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text size="small">Reviews commits against 7 criteria. APPROVED, CONTRADICTION, or REJECTED.</Text>
              <Text size="small" weight="semibold">Blocks:</Text>
              <Text size="small" tone="secondary">env files, scope creep, contradictions</Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <Divider />
      <H2>Shared Memory</H2>
      <Table
        headers={["File", "Purpose", "Writers"]}
        rows={[
          [".agent-session.md", "Compact session context: goal, fixes, review notes", "All agents"],
          [".code-validate-log.md", "Audit trail of approved commits", "code-validate"],
          ["unit-cache.json", "Cached unit investigations + dependency graph", "learn-and-suggest"],
        ]}
        striped
      />

      <Divider />
      <H2>Deploy Modes</H2>
      <Table
        headers={["Mode", "Script", "Reference File"]}
        rows={[
          ["Management Redeploy", "bootstrap.sh", "mgmt-redeploy.md"],
          ["Management Repair", "apply.sh", "mgmt-repair.md"],
          ["Workload Deploy", "apply-workload-cluster.sh", "workload-deploy.md"],
          ["Workload Repair", "apply-workload-cluster.sh", "workload-deploy.md"],
        ]}
        striped
      />

      <Callout tone="info" title="Token optimization">
        Merged Learn + Suggest into one agent. Deploy loads only the mode file needed. Session context uses compact 2-line entries. Unit cache skips investigation for repeat lookups. Estimated 27-44% token reduction.
      </Callout>
    </Stack>
  );
}
