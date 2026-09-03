import type { TaskDetailData, TaskDetailWorkspaceNode, TaskStatus } from '@lobechat/types';

// ── Formatting helpers for Task tool responses ──

const priorityLabel = (p?: number | null): string => {
  switch (p) {
    case 1: {
      return 'urgent';
    }
    case 2: {
      return 'high';
    }
    case 3: {
      return 'normal';
    }
    case 4: {
      return 'low';
    }
    default: {
      return '-';
    }
  }
};

const statusIcon = (s: string): string => {
  switch (s) {
    case 'backlog': {
      return '○';
    }
    case 'running': {
      return '●';
    }
    case 'paused': {
      return '◐';
    }
    case 'completed': {
      return '✓';
    }
    case 'failed': {
      return '✗';
    }
    case 'canceled': {
      return '⊘';
    }
    default: {
      return '?';
    }
  }
};

export interface TaskSummary {
  identifier: string;
  name?: string | null;
  priority?: number | null;
  status: string;
}

/**
 * Deep-link to a task's detail page, so the agent can present task identifiers
 * as clickable references — mirroring how Linear surfaces an issue's `url`.
 *
 * Pass `baseUrl` (e.g. `appEnv.APP_URL`) for an ABSOLUTE link. This is required
 * whenever the message can leave the app — IM/bot channels (Slack, Telegram,
 * WeChat…), push notifications, mobile — where there is no app origin to
 * resolve a relative path against. Omit it only for in-app (SPA) rendering,
 * where a relative path resolves against the current origin and is more durable.
 */
export const taskDetailHref = (identifier: string, baseUrl?: string): string => {
  const path = `/task/${identifier}`;
  return baseUrl ? `${baseUrl.replace(/\/$/, '')}${path}` : path;
};

/** Markdown-link form of a task identifier, e.g. `[T-198](https://app.lobehub.com/task/T-198)`. */
export const taskRef = (identifier: string, baseUrl?: string): string =>
  `[${identifier}](${taskDetailHref(identifier, baseUrl)})`;

// Re-export shared types from @lobechat/types for backward compatibility
export type {
  TaskDetailActivity,
  TaskDetailData,
  TaskDetailSubtask,
  TaskDetailWorkspaceNode,
} from '@lobechat/types';

/**
 * Format a single task as a one-line summary
 */
export const formatTaskLine = (t: TaskSummary): string =>
  `${t.identifier} ${statusIcon(t.status)} ${t.status}  ${t.name || '(unnamed)'}  [${priorityLabel(t.priority)}]`;

/**
 * Format createTask response
 */
export const formatTaskCreated = (
  t: TaskSummary & {
    /** Human owner label (e.g. "Alice (usr_1)") when the task was assigned to a workspace member. */
    assigneeLabel?: string;
    baseUrl?: string;
    instruction: string;
    parentLabel?: string;
  },
): string => {
  const lines = [
    `Task created: ${taskRef(t.identifier, t.baseUrl)} "${t.name}"`,
    `  Status: ${statusIcon(t.status)} ${t.status}`,
    `  Priority: ${priorityLabel(t.priority)}`,
  ];
  if (t.assigneeLabel) lines.push(`  Assignee: ${t.assigneeLabel}`);
  if (t.parentLabel) lines.push(`  Parent: ${taskRef(t.parentLabel, t.baseUrl)}`);
  lines.push(`  Instruction: ${t.instruction}`);
  return lines.join('\n');
};

export interface TaskCreatedItem {
  error?: string;
  identifier?: string;
  name: string;
  success: boolean;
}

/**
 * Format the createTasks (batch) response: a header plus one line per task,
 * with successful identifiers rendered as links (absolute when `baseUrl` is
 * given — required for IM / mobile, see {@link taskDetailHref}).
 *
 * Single source of truth shared by the client executor and the server runtime
 * so the two stay identical.
 */
export const formatTasksCreated = (results: TaskCreatedItem[], baseUrl?: string): string => {
  const lines = results.map((r, index) => {
    if (r.success) {
      const ref = r.identifier ? taskRef(r.identifier, baseUrl) : '(unknown id)';
      return `${index + 1}. ${ref} "${r.name}" — created`;
    }
    return `${index + 1}. "${r.name}" — failed: ${r.error ?? 'Unknown error'}`;
  });

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;
  const header =
    failed === 0
      ? `Created ${succeeded} task${succeeded === 1 ? '' : 's'}:`
      : `Created ${succeeded}/${results.length} tasks (${failed} failed):`;

  return [header, ...lines].join('\n');
};

export interface TaskListFilters {
  assigneeAgentId?: string;
  isDefaultScope?: boolean;
  isForAllAgents?: boolean;
  isForCurrentAgent?: boolean;
  parentIdentifier?: string;
  priorities?: number[];
  statuses?: TaskStatus[];
}

const buildTaskListLabel = (filters: TaskListFilters): string => {
  if (filters.isDefaultScope) {
    if (filters.isForAllAgents) return 'top-level unfinished tasks across all agents';
    return filters.isForCurrentAgent
      ? 'top-level unfinished tasks of the current agent'
      : 'top-level unfinished tasks';
  }

  const parts: string[] = [];
  if (filters.statuses?.length) parts.push(`status=[${filters.statuses.join(',')}]`);
  if (filters.priorities?.length) {
    parts.push(`priority=[${filters.priorities.map((p) => priorityLabel(p)).join(',')}]`);
  }
  if (filters.assigneeAgentId) parts.push(`agent=${filters.assigneeAgentId}`);

  if (filters.parentIdentifier) {
    return parts.length > 0
      ? `subtasks of ${filters.parentIdentifier} matching ${parts.join(', ')}`
      : `subtasks of ${filters.parentIdentifier}`;
  }

  return parts.length > 0 ? `tasks matching ${parts.join(', ')}` : 'tasks';
};

/**
 * Format task list response
 */
export const formatTaskList = (tasks: TaskSummary[], filters: TaskListFilters): string => {
  const label = buildTaskListLabel(filters);
  if (tasks.length === 0) {
    return `No ${label}.`;
  }

  return [`${tasks.length} ${label}:`, ...tasks.map((t) => `  ${formatTaskLine(t)}`)].join('\n');
};

/**
 * Format viewTask response
 */
export const formatTaskDetail = (t: TaskDetailData): string => {
  const lines = [
    `${t.identifier} ${t.name || '(unnamed)'}`,
    `Status: ${statusIcon(t.status)} ${t.status}     Priority: ${priorityLabel(t.priority)}`,
    `Instruction: ${t.instruction}`,
  ];

  if (t.agentId) lines.push(`Agent: ${t.agentId}`);
  // `userId` on the detail payload is the human assignee (workspace member).
  if (t.userId) lines.push(`Assignee (member): ${t.userId}`);
  if (t.parent) lines.push(`Parent: ${t.parent.identifier}`);
  if (t.topicCount) lines.push(`Topics: ${t.topicCount}`);
  if (t.createdAt) lines.push(`Created: ${t.createdAt}`);

  if (t.dependencies && t.dependencies.length > 0) {
    lines.push(
      `Dependencies: ${t.dependencies.map((d) => `${d.type}: ${d.dependsOn}`).join(', ')}`,
    );
  }

  // Subtasks (nested tree)
  if (t.subtasks && t.subtasks.length > 0) {
    lines.push('');
    lines.push('Subtasks:');
    const renderSubtasks = (nodes: NonNullable<typeof t.subtasks>, indent: string) => {
      for (const s of nodes) {
        const dep = s.blockedBy ? ` ← blocks: ${s.blockedBy}` : '';
        lines.push(
          `${indent}${s.identifier} ${statusIcon(s.status)} ${s.status} ${s.name || '(unnamed)'}${dep}`,
        );
        if (s.children && s.children.length > 0) {
          renderSubtasks(s.children, indent + '  ');
        }
      }
    };
    renderSubtasks(t.subtasks, '  ');
  }

  // Checkpoint
  lines.push('');
  if (t.checkpoint && Object.keys(t.checkpoint).length > 0) {
    lines.push(`Checkpoint: ${JSON.stringify(t.checkpoint)}`);
  } else {
    lines.push('Checkpoint: (not configured, default: onAgentRequest=true)');
  }

  // Workspace
  if (t.workspace && t.workspace.length > 0) {
    const countNodes = (nodes: TaskDetailWorkspaceNode[]): number =>
      nodes.reduce((sum, n) => sum + 1 + (n.children ? countNodes(n.children) : 0), 0);
    const total = countNodes(t.workspace);
    lines.push('');
    lines.push(`Workspace (${total}):`);

    const renderNodes = (nodes: TaskDetailWorkspaceNode[], indent: string, isChild: boolean) => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const isFolder = node.fileType === 'custom/folder';
        const isLast = i === nodes.length - 1;
        const icon = isFolder ? '📁' : '📄';
        const connector = isChild ? (isLast ? '└── ' : '├── ') : '';
        const source = node.sourceTaskIdentifier ? ` ← ${node.sourceTaskIdentifier}` : '';
        const sizeStr = !isFolder && node.size ? `  ${node.size} chars` : '';
        lines.push(
          `${indent}${connector}${icon} ${node.title || 'Untitled'} (${node.documentId})${source}${sizeStr}`,
        );
        if (node.children) {
          const childIndent = isChild ? indent + (isLast ? '    ' : '│   ') : indent;
          renderNodes(node.children, childIndent, true);
        }
      }
    };
    renderNodes(t.workspace, '  ', false);
  }

  // Activities (already sorted desc by service)
  if (t.activities && t.activities.length > 0) {
    lines.push('');
    lines.push('Activities:');
    for (const act of t.activities) {
      const idSuffix = act.id ? `  ${act.id}` : '';
      if (act.type === 'topic') {
        const status = act.status || 'completed';
        lines.push(
          `  💬 ${act.time || ''} Topic #${act.seq || '?'} ${act.title || 'Untitled'} ${statusIcon(status)} ${status}${idSuffix}`,
        );
      } else if (act.type === 'brief') {
        const resolvedLabel = act.resolvedAction
          ? act.resolvedComment
            ? `${act.resolvedAction}: ${act.resolvedComment}`
            : act.resolvedAction
          : '';
        const resolved = resolvedLabel ? ` ✏️ ${resolvedLabel}` : '';
        const priStr = act.priority ? ` [${act.priority}]` : '';
        lines.push(
          `  ${briefIcon(act.briefType || '')} ${act.time || ''} Brief [${act.briefType}] ${act.title}${priStr}${resolved}${idSuffix}`,
        );
      } else if (act.type === 'comment') {
        const author = act.agentId ? '🤖 agent' : '👤 user';
        const content = act.content || '';
        const truncated = content.length > 80 ? content.slice(0, 80) + '...' : content;
        lines.push(`  💭 ${act.time || ''} ${author} ${truncated}${idSuffix}`);
      }
    }
  }

  return lines.join('\n');
};

// ── Workspace members (task assignee candidates) ──

export interface TaskAssignableMember {
  /** Workspace email — an exact handle for matching a person named by address. */
  email?: string | null;
  /** User id — the value to pass as `assigneeUserId`. */
  id: string;
  /**
   * Linked IM identities, formatted `platform:@username(platformUserId)` (or
   * `platform:platformUserId` without a username). Lets a person named by a
   * Discord/Slack/Telegram handle or a raw `<@platformUserId>` mention be
   * resolved deterministically instead of by name similarity.
   */
  imAccounts?: string[];
  /** The signed-in user who invoked the tool. */
  isSelf?: boolean;
  name?: string | null;
  role?: string | null;
  username?: string | null;
}

/**
 * Format the listWorkspaceMembers response: one line per member with the id
 * the model must pass back as `assigneeUserId`. Shared by the client executor
 * and the server runtime so both surfaces read identically.
 */
export const formatWorkspaceMembers = (
  members: TaskAssignableMember[],
  options: { inWorkspace: boolean; query?: string; total?: number } = { inWorkspace: true },
): string => {
  const { inWorkspace, query } = options;
  if (members.length === 0) {
    if (query)
      return `No workspace members match "${query}". Try a different name, @handle, email or platform id.`;
    return inWorkspace
      ? 'No workspace members can be assigned tasks.'
      : 'Not in a workspace: tasks can only be assigned to agents here.';
  }

  // "(3)" when the whole directory fits; "(50 of 213 — pass query to narrow)"
  // when the cap cut it, so the model refines instead of assuming it saw all.
  const total = options.total ?? members.length;
  const count =
    total > members.length
      ? `${members.length} of ${total} — pass query to narrow`
      : `${members.length}`;
  const scope = query ? ` matching "${query}"` : '';
  const header = inWorkspace
    ? `Workspace members that can be assigned tasks${scope} (${count}). Use the id as assigneeUserId:`
    : 'Not in a workspace — the only person a task can be assigned to is you:';

  const lines = members.map((m) => {
    const name = m.name?.trim() || m.username?.trim() || '(unnamed)';
    const parts = [`- ${name}`];
    if (m.username && m.username !== name) parts.push(`@${m.username}`);
    if (m.email) parts.push(m.email);
    if (m.role) parts.push(`role=${m.role}`);
    if (m.imAccounts && m.imAccounts.length > 0) parts.push(`im=${m.imAccounts.join(',')}`);
    if (m.isSelf) parts.push('(you)');
    parts.push(`id=${m.id}`);
    return parts.join('  ');
  });

  return [header, ...lines].join('\n');
};

/**
 * Format editTask response
 */
export const formatTaskEdited = (identifier: string, changes: string[]): string =>
  `Task ${identifier} updated:\n  ${changes.join('\n  ')}`;

/**
 * Format deleteTask response
 */
export const formatTaskDeleted = (identifier: string, name?: string | null): string =>
  name ? `Task ${identifier} "${name}" has been deleted.` : `Task ${identifier} has been deleted.`;

/**
 * Format dependency change response
 */
export const formatDependencyAdded = (task: string, dependsOn: string): string =>
  `Dependency added: ${task} now blocks on ${dependsOn}.\n${task} will not start until ${dependsOn} is completed.`;

export const formatDependencyRemoved = (task: string, dependsOn: string): string =>
  `Dependency removed: ${task} no longer blocks on ${dependsOn}.`;

/**
 * Format brief created response
 */
export const formatBriefCreated = (args: {
  id: string;
  priority: string;
  summary: string;
  title: string;
  type: string;
}): string =>
  `Brief created (${args.type}, ${args.priority}):\n  "${args.title}"\n  ${args.summary}\n\nBrief ID: ${args.id}`;

/**
 * Format checkpoint response
 */
export const formatCheckpointCreated = (reason: string): string =>
  `Checkpoint created. Task is now paused and waiting for user review.\n\nReason: ${reason}\n\nThe user will see this as a "decision" brief and can resume the task after review.`;

// ── Task Run Prompt Builder ──

export interface TaskRunPromptAttachment {
  fileType?: string;
  id: string;
  name: string;
}

export interface TaskRunPromptComment {
  agentId?: string | null;
  content: string;
  createdAt?: string;
  /** Lightweight metadata of files attached to this comment. The actual file
   * content (image bytes / parsed text) is passed to the agent runtime as
   * multimodal `fileIds`; this list is just so the LLM knows what files exist
   * and which comment they were attached to. */
  files?: TaskRunPromptAttachment[];
  id?: string;
}

export interface TaskRunPromptTopic {
  createdAt: string;
  handoff?: {
    keyFindings?: string[];
    nextAction?: string;
    summary?: string;
    title?: string;
  } | null;
  id?: string;
  seq?: number | null;
  status?: string | null;
  title?: string | null;
}

export interface TaskRunPromptBrief {
  createdAt: string;
  id?: string;
  priority?: string | null;
  resolvedAction?: string | null;
  resolvedAt?: string | null;
  resolvedComment?: string | null;
  summary: string;
  title: string;
  type: string;
}

export interface TaskRunPromptSubtask {
  createdAt?: string;
  id?: string;
  identifier: string;
  name?: string | null;
  status: string;
}

export interface TaskRunPromptWorkspaceNode {
  children?: TaskRunPromptWorkspaceNode[];
  createdAt?: string;
  documentId: string;
  fileType?: string;
  size?: number;
  sourceTaskIdentifier?: string;
  title?: string;
}

/**
 * Goal-loop context for a round spawned by the outer verify-driven loop: what
 * the previous round left unresolved, so the new (fresh-context) topic can pick
 * up without re-discovering everything.
 */
export interface TaskRunPromptGoalLoop {
  /** Checks that did not pass in the previous round, with the verifier's why/suggestion. */
  failedChecks?: Array<{ title: string; why?: string }>;
  /** Round budget. Null/undefined = uncapped. */
  maxRounds?: number | null;
  /** The user's reject comment on the previous delivery — highest-priority input. */
  rejectComment?: string;
  /** 1-based index of the round this prompt is for. */
  round?: number;
}

export interface TaskRunPromptInput {
  /** Activity data (all optional) */
  activities?: {
    briefs?: TaskRunPromptBrief[];
    comments?: TaskRunPromptComment[];
    subtasks?: TaskRunPromptSubtask[];
    topics?: TaskRunPromptTopic[];
  };
  /** --prompt flag content */
  extraPrompt?: string;
  /** Present only for rounds spawned by the goal outer loop. */
  goalLoop?: TaskRunPromptGoalLoop;
  /** Parent task context (when current task is a subtask) */
  parentTask?: {
    identifier: string;
    instruction: string;
    name?: string | null;
    subtasks?: Array<TaskSummary & { blockedBy?: string }>;
  };
  /** Task data */
  task: {
    assigneeAgentId?: string | null;
    automationMode?: 'heartbeat' | 'schedule' | null;
    dependencies?: Array<{ dependsOn: string; type: string }>;
    description?: string | null;
    /** Lightweight metadata of files attached to the task instruction. Actual
     * content is forwarded to the agent runtime via `fileIds` on execAgent. */
    files?: TaskRunPromptAttachment[];
    heartbeatInterval?: number | null;
    id: string;
    identifier: string;
    instruction: string;
    name?: string | null;
    parentIdentifier?: string | null;
    priority?: number | null;
    review?: {
      enabled?: boolean;
      maxIterations?: number;
      rubrics?: Array<{ name: string; threshold?: number; type: string }>;
    } | null;
    schedulePattern?: string | null;
    scheduleTimezone?: string | null;
    status: string;
    subtasks?: Array<TaskSummary & { blockedBy?: string }>;
    /** Delivery-acceptance criteria the builder must self-evidence while working. */
    verify?: {
      criteria?: Array<{
        required?: boolean;
        requiredEvidence?: Array<{ hint?: string; type: string }>;
        title: string;
      }>;
      enabled?: boolean;
      maxIterations?: number;
      requirement?: string;
    } | null;
  };
  /** Pinned documents (workspace) */
  workspace?: TaskRunPromptWorkspaceNode[];
}

// ── Relative time helper ──

const timeAgo = (dateStr: string, now?: Date): string => {
  const date = new Date(dateStr);
  const ref = now || new Date();
  const diffMs = ref.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
};

// ── Heartbeat interval helper ──

const formatInterval = (seconds: number): string => {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
};

// ── Brief icon ──

const briefIcon = (type: string): string => {
  switch (type) {
    case 'decision': {
      return '📋';
    }
    case 'result': {
      return '✅';
    }
    case 'insight': {
      return '💡';
    }
    case 'error': {
      return '❌';
    }
    default: {
      return '📌';
    }
  }
};

/**
 * Build the prompt for task.run — injected as user message to the Agent.
 *
 * Priority order:
 * 1. High Priority Instruction (--prompt) — the most important directive for this run
 * 2. User Feedback (user comments only, full content) — what the user wants
 * 3. Activities (topics + briefs + comments + subtasks, chronological) — full timeline
 * 4. Original Task (instruction + description) — the base requirement
 */
export const buildTaskRunPrompt = (input: TaskRunPromptInput, now?: Date): string => {
  const { task, activities, extraPrompt, goalLoop, workspace, parentTask } = input;
  const sections: string[] = [];

  // ── 1. High Priority Instruction ──
  if (extraPrompt) {
    sections.push(`<high_priority_instruction>\n${extraPrompt}\n</high_priority_instruction>`);
  }

  // ── 2. User Feedback (user comments only, full content) ──
  const userComments = activities?.comments?.filter((c) => !c.agentId);
  if (userComments && userComments.length > 0) {
    const lines = userComments.map((c) => {
      const ago = c.createdAt ? timeAgo(c.createdAt, now) : '';
      const timeAttr = ago ? ` time="${ago}"` : '';
      const idAttr = c.id ? ` id="${c.id}"` : '';
      const attachments =
        c.files && c.files.length > 0
          ? `\n<attachments>\n${c.files.map((f) => `  - ${f.name}${f.fileType ? ` (${f.fileType})` : ''}`).join('\n')}\n</attachments>`
          : '';
      return `<comment${idAttr}${timeAttr}>${c.content}${attachments}</comment>`;
    });
    sections.push(`<user_feedback>\n${lines.join('\n')}\n</user_feedback>`);
  }

  // ── 3. Task context (full detail so agent doesn't need to call viewTask) ──
  const taskLines = [
    `<task>`,
    `<hint>This tag contains the complete task context. Do NOT call viewTask to re-fetch it.</hint>`,
    `${task.identifier} ${task.name || task.identifier}`,
    `Status: ${statusIcon(task.status)} ${task.status}     Priority: ${priorityLabel(task.priority)}`,
  ];
  if (task.automationMode) {
    const cadence =
      task.automationMode === 'heartbeat' && task.heartbeatInterval
        ? `heartbeat, every ${formatInterval(task.heartbeatInterval)}`
        : task.automationMode === 'schedule' && task.schedulePattern
          ? `cron "${task.schedulePattern}" (${task.scheduleTimezone || 'UTC'})`
          : task.automationMode;
    taskLines.push(
      `Automation: ${cadence} — this task is a recurring loop and this run is one tick of it. When the run ends, the next tick is armed automatically; a tick with nothing to do is still a successful run. NEVER set this task to completed (or any terminal status) — that permanently stops the loop.`,
    );
  }
  taskLines.push(`Instruction: ${task.instruction}`);
  if (task.description) taskLines.push(`Description: ${task.description}`);
  if (task.files && task.files.length > 0) {
    taskLines.push('Attachments (contents provided separately as multimodal inputs):');
    for (const f of task.files) {
      taskLines.push(`  - ${f.name}${f.fileType ? ` (${f.fileType})` : ''}`);
    }
  }
  if (task.assigneeAgentId) taskLines.push(`Agent: ${task.assigneeAgentId}`);
  if (task.parentIdentifier) taskLines.push(`Parent: ${task.parentIdentifier}`);

  const topicCount = activities?.topics?.length ?? 0;
  if (topicCount > 0) taskLines.push(`Topics: ${topicCount}`);

  if (task.dependencies && task.dependencies.length > 0) {
    taskLines.push(
      `Dependencies: ${task.dependencies.map((d) => `${d.type}: ${d.dependsOn}`).join(', ')}`,
    );
  }

  // Subtasks
  if (task.subtasks && task.subtasks.length > 0) {
    taskLines.push('');
    taskLines.push('Subtasks:');
    for (const s of task.subtasks) {
      const dep = s.blockedBy ? ` ← blocks: ${s.blockedBy}` : '';
      taskLines.push(
        `  ${s.identifier} ${statusIcon(s.status)} ${s.status} ${s.name || '(unnamed)'}${dep}`,
      );
    }
  }

  // Review
  taskLines.push('');
  if (task.review?.enabled && task.review.rubrics && task.review.rubrics.length > 0) {
    taskLines.push(`Review (maxIterations: ${task.review.maxIterations || 3}):`);
    for (const r of task.review.rubrics) {
      taskLines.push(
        `  - ${r.name} [${r.type}]${r.threshold ? ` ≥ ${Math.round(r.threshold * 100)}%` : ''}`,
      );
    }
  } else {
    taskLines.push('Review: (not configured)');
  }

  // Verify — delivery acceptance (builder self-evidence)
  if (task.verify?.enabled && (task.verify.criteria?.length || task.verify.requirement)) {
    taskLines.push('');
    taskLines.push(
      `Verify — delivery acceptance (maxIterations: ${task.verify.maxIterations || 3}):`,
    );
    if (task.verify.requirement) {
      taskLines.push(`  Requirement: ${task.verify.requirement}`);
    }
    if (task.verify.criteria && task.verify.criteria.length > 0) {
      taskLines.push('  Criteria — capture the listed evidence while you work:');
      for (const c of task.verify.criteria) {
        const flag = c.required === false ? '' : ' (required)';
        taskLines.push(`    - ${c.title}${flag}`);
        for (const e of c.requiredEvidence ?? []) {
          taskLines.push(`        · evidence: ${e.type}${e.hint ? ` — ${e.hint}` : ''}`);
        }
      }
    }
    taskLines.push(
      '  Produce concrete evidence while you work, and include artifact paths, commands, and observed results in your final response.',
    );
    taskLines.push(
      '  Do not judge the Acceptance. A dedicated post-run phase will ask you to submit the evidence you produced; an independent verifier decides whether this Task is complete.',
    );
  }

  // Goal loop — context handed over from the previous round of the outer loop
  if (goalLoop) {
    taskLines.push('');
    const budget = typeof goalLoop.maxRounds === 'number' ? ` of ${goalLoop.maxRounds}` : '';
    taskLines.push(
      `Goal loop${goalLoop.round ? ` — round ${goalLoop.round}${budget}` : ''}: earlier rounds did not fully meet the acceptance criteria. Focus on closing the gaps below instead of redoing finished work.`,
    );
    if (goalLoop.rejectComment) {
      taskLines.push('  User feedback on the last delivery (address this first):');
      taskLines.push(`    "${goalLoop.rejectComment}"`);
    }
    if (goalLoop.failedChecks && goalLoop.failedChecks.length > 0) {
      taskLines.push('  Unresolved checks from the last round:');
      for (const [i, check] of goalLoop.failedChecks.entries()) {
        taskLines.push(`    ${i + 1}. ${check.title}${check.why ? ` — ${check.why}` : ''}`);
      }
    }
    taskLines.push(
      '  To read a previous round in full, run: `lh task topic view ' +
        task.identifier +
        ' <seq>` (seq from the Activities list below).',
    );
  }

  // Workspace
  if (workspace && workspace.length > 0) {
    const countNodes = (nodes: TaskRunPromptWorkspaceNode[]): number =>
      nodes.reduce((sum, n) => sum + 1 + (n.children ? countNodes(n.children) : 0), 0);
    const total = countNodes(workspace);
    taskLines.push('');
    taskLines.push(`Workspace (${total}):`);

    const renderNodes = (nodes: TaskRunPromptWorkspaceNode[], indent: string, isChild: boolean) => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const isFolder = node.fileType === 'custom/folder';
        const isLast = i === nodes.length - 1;
        const icon = isFolder ? '📁' : '📄';
        const connector = isChild ? (isLast ? '└── ' : '├── ') : '';
        const source = node.sourceTaskIdentifier ? ` ← ${node.sourceTaskIdentifier}` : '';
        const sizeStr = !isFolder && node.size ? `  ${node.size} chars` : '';
        const ago = node.createdAt ? `  ${timeAgo(node.createdAt, now)}` : '';
        taskLines.push(
          `${indent}${connector}${icon} ${node.title || 'Untitled'} (${node.documentId})${source}${sizeStr}${ago}`,
        );
        if (node.children) {
          const childIndent = isChild ? indent + (isLast ? '    ' : '│   ') : indent;
          renderNodes(node.children, childIndent, true);
        }
      }
    };
    renderNodes(workspace, '  ', false);
  }

  // Activities (chronological, flat list)
  const timelineEntries: { text: string; time: number }[] = [];

  if (activities?.topics) {
    // Older rounds stay title-only to bound prompt size; the most recent ones
    // carry their full handoff so the next round starts from real context
    // instead of a bare title.
    const detailedSeqs = new Set(
      [...activities.topics]
        .map((t) => t.seq ?? 0)
        .sort((a, b) => b - a)
        .slice(0, 2),
    );
    for (const t of activities.topics) {
      const ago = timeAgo(t.createdAt, now);
      const status = t.status || 'completed';
      const title = t.title || t.handoff?.title || 'Untitled';
      const idSuffix = t.id ? `  ${t.id}` : '';
      const lines = [
        `  💬 ${ago} Topic #${t.seq || '?'} ${title} ${statusIcon(status)} ${status}${idSuffix}`,
      ];
      if (t.handoff && detailedSeqs.has(t.seq ?? 0)) {
        if (t.handoff.summary) lines.push(`      ↳ summary: ${t.handoff.summary}`);
        if (t.handoff.keyFindings && t.handoff.keyFindings.length > 0)
          lines.push(`      ↳ findings: ${t.handoff.keyFindings.join('; ')}`);
        if (t.handoff.nextAction) lines.push(`      ↳ next: ${t.handoff.nextAction}`);
      }
      timelineEntries.push({
        text: lines.join('\n'),
        time: new Date(t.createdAt).getTime(),
      });
    }
  }

  if (activities?.briefs) {
    for (const b of activities.briefs) {
      const ago = timeAgo(b.createdAt, now);
      let resolved = '';
      if (b.resolvedAt && b.resolvedAction) {
        resolved = b.resolvedComment ? ` ✏️ ${b.resolvedComment}` : ` ✅ ${b.resolvedAction}`;
      }
      const priStr = b.priority ? ` [${b.priority}]` : '';
      const idSuffix = b.id ? `  ${b.id}` : '';
      timelineEntries.push({
        text: `  ${briefIcon(b.type)} ${ago} Brief [${b.type}] ${b.title}${priStr}${resolved}${idSuffix}`,
        time: new Date(b.createdAt).getTime(),
      });
    }
  }

  if (activities?.comments) {
    for (const c of activities.comments) {
      const author = c.agentId ? '🤖 agent' : '👤 user';
      const ago = c.createdAt ? timeAgo(c.createdAt, now) : '';
      const truncated = c.content.length > 80 ? c.content.slice(0, 80) + '...' : c.content;
      timelineEntries.push({
        text: `  💭 ${ago} ${author} ${truncated}`,
        time: c.createdAt ? new Date(c.createdAt).getTime() : 0,
      });
    }
  }

  if (timelineEntries.length > 0) {
    timelineEntries.sort((a, b) => a.time - b.time);
    taskLines.push('');
    taskLines.push('Activities:');
    taskLines.push(...timelineEntries.map((e) => e.text));
  }

  // Parent task context
  if (parentTask) {
    taskLines.push('');
    taskLines.push(
      `<parentTask identifier="${parentTask.identifier}" name="${parentTask.name || parentTask.identifier}">`,
    );
    taskLines.push(`  Instruction: ${parentTask.instruction}`);
    if (parentTask.subtasks && parentTask.subtasks.length > 0) {
      taskLines.push(`  Subtasks (${parentTask.subtasks.length}):`);
      for (const s of parentTask.subtasks) {
        const dep = s.blockedBy ? ` ← blocks: ${s.blockedBy}` : '';
        const marker = s.identifier === task.identifier ? ' ◀ current' : '';
        taskLines.push(
          `    ${s.identifier} ${statusIcon(s.status)} ${s.status} ${s.name || '(unnamed)'}${dep}${marker}`,
        );
      }
    }
    taskLines.push('</parentTask>');
  }

  taskLines.push('</task>');
  sections.push(taskLines.join('\n'));

  return sections.join('\n\n');
};

export { briefIcon, priorityLabel, statusIcon, timeAgo };

export type { BuildTaskDetailPromptInput } from './buildTaskDetailPrompt';
export { buildTaskDetailPrompt } from './buildTaskDetailPrompt';
export type { BuildTaskListPromptInput } from './buildTaskListPrompt';
export { buildTaskListPrompt } from './buildTaskListPrompt';
export type { TaskManagerPromptDefaults } from './taskManagerDefaults';
export { buildTaskManagerDefaultsPrompt } from './taskManagerDefaults';
