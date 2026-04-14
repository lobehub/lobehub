import type { TaskDetailData, TaskDetailWorkspaceNode } from './index';
import { briefIcon, priorityLabel, statusIcon, timeAgo } from './index';

export interface BuildTaskDetailPromptInput {
  task: TaskDetailData;
}

/**
 * Task detail prompt for Task Manager conversational reference.
 * Variant of `buildTaskRunPrompt` without `<high_priority_instruction>`.
 */
export const buildTaskDetailPrompt = (input: BuildTaskDetailPromptInput, now?: Date): string => {
  const { task } = input;
  const { activities, workspace } = task;

  const lines: string[] = [
    `<page_context>The user is currently viewing the detail page of task ${task.identifier}. When the user says "this task" or refers ambiguously, it means ${task.identifier}.</page_context>`,
    '<task>',
    `<hint>This tag contains the complete context of the task the user is viewing. Do NOT call viewTask to re-fetch it.</hint>`,
    `${task.identifier} ${task.name || '(unnamed)'}`,
    `Status: ${statusIcon(task.status)} ${task.status}     Priority: ${priorityLabel(task.priority)}`,
    `Instruction: ${task.instruction}`,
  ];
  if (task.description) lines.push(`Description: ${task.description}`);
  if (task.agentId) lines.push(`Agent: ${task.agentId}`);
  if (task.parent) lines.push(`Parent: ${task.parent.identifier}`);
  if (task.topicCount) lines.push(`Topics: ${task.topicCount}`);

  if (task.dependencies && task.dependencies.length > 0) {
    lines.push(
      `Dependencies: ${task.dependencies.map((d) => `${d.type}: ${d.dependsOn}`).join(', ')}`,
    );
  }

  if (task.subtasks && task.subtasks.length > 0) {
    lines.push('');
    lines.push('Subtasks:');
    const renderSubtasks = (nodes: NonNullable<typeof task.subtasks>, indent: string) => {
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
    renderSubtasks(task.subtasks, '  ');
  }

  lines.push('');
  if (task.review && Object.keys(task.review).length > 0) {
    const review = task.review as {
      maxIterations?: number;
      rubrics?: Array<{ name: string; threshold?: number; type: string }>;
    };
    lines.push(`Review (maxIterations: ${review.maxIterations || 3}):`);
    if (review.rubrics) {
      for (const r of review.rubrics) {
        lines.push(
          `  - ${r.name} [${r.type}]${r.threshold ? ` ≥ ${Math.round(r.threshold * 100)}%` : ''}`,
        );
      }
    }
  } else {
    lines.push('Review: (not configured)');
  }

  if (workspace && workspace.length > 0) {
    const countNodes = (nodes: TaskDetailWorkspaceNode[]): number =>
      nodes.reduce((sum, n) => sum + 1 + (n.children ? countNodes(n.children) : 0), 0);
    const total = countNodes(workspace);
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
    renderNodes(workspace, '  ', false);
  }

  if (activities && activities.length > 0) {
    lines.push('');
    lines.push('Activities:');
    for (const act of activities) {
      const ago = act.time ? timeAgo(act.time, now) : '';
      const idSuffix = act.id ? `  ${act.id}` : '';
      if (act.type === 'topic') {
        const status = act.status || 'completed';
        lines.push(
          `  💬 ${ago} Topic #${act.seq || '?'} ${act.title || 'Untitled'} ${statusIcon(status)} ${status}${idSuffix}`,
        );
      } else if (act.type === 'brief') {
        const resolved = act.resolvedAction ? ` ✏️ ${act.resolvedAction}` : '';
        const priStr = act.priority ? ` [${act.priority}]` : '';
        lines.push(
          `  ${briefIcon(act.briefType || '')} ${ago} Brief [${act.briefType}] ${act.title}${priStr}${resolved}${idSuffix}`,
        );
      } else if (act.type === 'comment') {
        const author = act.agentId ? '🤖 agent' : '👤 user';
        const content = act.content || '';
        const truncated = content.length > 200 ? content.slice(0, 200) + '...' : content;
        lines.push(`  💭 ${ago} ${author} ${truncated}`);
      }
    }
  }

  lines.push('</task>');

  return lines.join('\n');
};
