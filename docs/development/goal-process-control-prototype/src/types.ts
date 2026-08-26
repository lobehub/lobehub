// Domain-shaped view types for the Goal process-control surface.
// Mirrors packages/types/src/goal.ts (GoalGraphNode / GoalGraphEdge / GoalGraphDecision) plus the
// per-node execution projection (owner Task, attempts, liveness) the page needs.

export type NodeKind = 'goal' | 'problem' | 'work' | 'finding' | 'decision';
export type NodeStatus = 'proposed' | 'active' | 'waiting' | 'resolved' | 'rejected' | 'retired';
export type EdgeKind =
  | 'decomposes'
  | 'depends_on'
  | 'investigates'
  | 'produces'
  | 'supports'
  | 'contradicts'
  | 'leads_to';
export type Edge = [string, string, EdgeKind];

export interface Attempt {
  n: number;
  started: number;
  ended: number;
  outcome: 'passed' | 'failed' | 'abandoned';
  cost: number;
  reason: string;
  taskId?: string;
}

export interface Artifact {
  name: string;
  /** Rough size label, e.g. "123 MB". */
  size?: string;
  kind?: 'file' | 'checkpoint' | 'doc';
}

export interface OwnerTask {
  id: string;
  agent: string;
}

export interface GoalNode {
  id: string;
  kind: NodeKind;
  title: string;
  status: NodeStatus;
  /** Human-facing short ref (W-3). Shown only in detail, never in the list. */
  ref?: string;
  description?: string;
  /** Finding / decision body. */
  body?: string;
  cost?: number;
  priority?: number;
  dependsOn?: string[];
  attempts?: Attempt[];
  task?: OwnerTask;
  /** When the current attempt started — drives the running clock. */
  startedAt?: number;
  /** Last operation heartbeat (liveness). */
  lastActivity?: number;
  /** Last tool / assistant line from the owner Task's running topic. */
  lastLine?: string;
  /** Resolution time. */
  at?: number;
  /** Finding: the Work (or Problem) it came from. */
  from?: string;
  /** Decision: who is allowed to resolve it. */
  authority?: 'agent' | 'user';
  /** Decision sub-type. Only gates are decision nodes; other human actions mark the Work itself. */
  subtype?: 'gate';
  /** Work: the terminal "Complete full Goal acceptance" Work. */
  terminal?: boolean;
  /** Work: verifier passed, waiting for the human accept. */
  delivered?: boolean;
  /** Work: does this Work have its own acceptance contract (a verifier judges its delivery)? */
  hasVerifier?: boolean;
  /** Work: artifacts registered by its attempts (work versions / files). */
  artifacts?: Artifact[];
  /**
   * Human actions taken on this Work (budget top-up, gate choice, acceptance). Derived from
   * goal_events / acceptance decisions / task comments — shown as a 你 badge, never as extra nodes.
   */
  humanTouches?: HumanTouch[];
}

export type HumanTouchKind = 'budget' | 'retry' | 'retire' | 'accept' | 'reject' | 'guidance';

export interface HumanTouch {
  t: number;
  kind: HumanTouchKind;
  text: string;
}

export interface DecisionOption {
  id: string;
  label: string;
  consequence: string;
}

export interface PendingDecision {
  id: string;
  nodeId: string;
  workId: string;
  why: string;
  options: DecisionOption[];
  recommended: string;
}

export interface GoalCheck {
  label: string;
  state: 'pending' | 'passed' | 'failed';
}

export interface GoalInfo {
  id: string;
  title: string;
  agent: string;
  requirement: string;
  checks: GoalCheck[];
  maxRounds: number | null;
  maxTotalCost: number | null;
  maxAttemptsPerWork: number;
  leaseTimeoutMin: number;
  startedAt: number | null;
  completedAt?: number;
  status:
    'planning' | 'running' | 'verifying' | 'review' | 'paused' | 'achieved' | 'failed' | 'canceled';
  pauseCause?: 'user' | 'cost' | 'rounds';
  spent: number;
  lastActivity: number | null;
}

export type ActivityKind =
  | 'create'
  | 'start'
  | 'progress'
  | 'pass'
  | 'fail'
  | 'abandon'
  | 'finding'
  | 'decision'
  | 'budget'
  | 'pause'
  | 'resume'
  | 'comment'
  | 'achieved';

export interface ActivityEvent {
  t: number;
  kind: ActivityKind;
  /** 你 · 系统 · Agent · verifier · <agent name> */
  who: string;
  text: string;
  /** Node the event is about — rendered as a chip that highlights the graph. */
  nodeId?: string;
  detail?: string;
}

export interface GoalState {
  goal: GoalInfo;
  nodes: GoalNode[];
  edges: Edge[];
  decision: PendingDecision | null;
  log: ActivityEvent[];
}
