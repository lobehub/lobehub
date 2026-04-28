import type { TaskSummary } from './index';
import { priorityLabel, statusIcon, timeAgo } from './index';

export interface BuildTaskListPromptInput {
  tasks: Array<TaskSummary & { createdAt?: string | Date }>;
  total: number;
}

/**
 * Task list prompt for Task Manager conversational reference.
 */
export const buildTaskListPrompt = (input: BuildTaskListPromptInput, now?: Date): string => {
  const { tasks, total } = input;
  const shown = tasks.length;

  const lines: string[] = [
    '<task_list>',
    `<hint>The user is currently viewing the tasks list page. These are the ${shown} task(s) displayed in the UI. Do NOT call listTasks to re-fetch them.</hint>`,
  ];

  if (shown === 0) {
    lines.push('(no tasks)');
  } else {
    const countLine =
      total > shown ? `Total: ${total} (showing most recent ${shown})` : `Total: ${total}`;
    lines.push(countLine);
    lines.push('');
    for (const t of tasks) {
      const ago = t.createdAt
        ? `  ${timeAgo(typeof t.createdAt === 'string' ? t.createdAt : t.createdAt.toISOString(), now)}`
        : '';
      lines.push(
        `  ${t.identifier} ${statusIcon(t.status)} ${t.status}  [${priorityLabel(t.priority)}]  ${t.name || '(unnamed)'}${ago}`,
      );
    }
    if (total > shown) {
      lines.push('');
      lines.push(
        `Only the most recent ${shown} tasks are shown above. Use the \`listTasks\` tool to query the full list of ${total} tasks.`,
      );
    }
  }
  lines.push('</task_list>');

  return lines.join('\n');
};
