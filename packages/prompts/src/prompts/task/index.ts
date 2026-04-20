import type { TaskDetailData, TaskDetailWorkspaceNode } from '@lobechat/types';

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
  t: TaskSummary & { instruction: string; parentLabel?: string },
): string => {
  const lines = [
    `Task created: ${t.identifier} "${t.name}"`,
    `  Status: ${statusIcon(t.status)} ${t.status}`,
    `  Priority: ${priorityLabel(t.priority)}`,
  ];
  if (t.parentLabel) lines.push(`  Parent: ${t.parentLabel}`);
  lines.push(`  Instruction: ${t.instruction}`);
  return lines.join('\n');
};

/**
 * Format task list response
 */
export const formatTaskList = (
  tasks: TaskSummary[],
  parentLabel: string,
  filter?: string,
): string => {
  if (tasks.length === 0) {
    const filterNote = filter ? ` with status "${filter}"` : '';
    return `No subtasks found under ${parentLabel}${filterNote}.`;
  }

  return [
    `${tasks.length} task(s) under ${parentLabel}:`,
    ...tasks.map((t) => `  ${formatTaskLine(t)}`),
  ].join('\n');
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

  // Review
  lines.push('');
  if (t.review && Object.keys(t.review).length > 0) {
    const rubrics = (t.review as any).rubrics as
      | Array<{ name: string; threshold?: number; type: string }>
      | undefined;
    lines.push(`Review (maxIterations: ${(t.review as any).maxIterations || 3}):`);
    if (rubrics) {
      for (const r of rubrics) {
        lines.push(
          `  - ${r.name} [${r.type}]${r.threshold ? ` ≥ ${Math.round(r.threshold * 100)}%` : ''}`,
        );
      }
    }
  } else {
    lines.push('Review: (not configured)');
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
        lines.push(`  💭 ${act.time || ''} ${author} ${truncated}`);
      }
    }
  }

  return lines.join('\n');
};

/**
 * Format editTask response
 */
export const formatTaskEdited = (identifier: string, changes: string[]): string =>
  `Task ${identifier} updated:\n  ${changes.join('\n  ')}`;

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

export interface TaskRunPromptComment {
  agentId?: string | null;
  content: string;
  createdAt?: string;
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
    dependencies?: Array<{ dependsOn: string; type: string }>;
    description?: string | null;
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
    status: string;
    subtasks?: Array<TaskSummary & { blockedBy?: string }>;
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
  const { task, activities, extraPrompt, workspace, parentTask } = input;
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
      return `<comment${idAttr}${timeAttr}>${c.content}</comment>`;
    });
    sections.push(`<user_feedback>\n${lines.join('\n')}\n</user_feedback>`);
  }

  // ── 3. Task context (full detail so agent doesn't need to call viewTask) ──
  const taskLines = [
    `<task>`,
    `<hint>This tag contains the complete task context. Do NOT call viewTask to re-fetch it.</hint>`,
    `${task.identifier} ${task.name || task.identifier}`,
    `Status: ${statusIcon(task.status)} ${task.status}     Priority: ${priorityLabel(task.priority)}`,
    `Instruction: ${task.instruction}`,
  ];
  if (task.description) taskLines.push(`Description: ${task.description}`);
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
    for (const t of activities.topics) {
      const ago = timeAgo(t.createdAt, now);
      const status = t.status || 'completed';
      const title = t.title || t.handoff?.title || 'Untitled';
      const idSuffix = t.id ? `  ${t.id}` : '';
      timelineEntries.push({
        text: `  💬 ${ago} Topic #${t.seq || '?'} ${title} ${statusIcon(status)} ${status}${idSuffix}`,
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

export { priorityLabel, statusIcon };
