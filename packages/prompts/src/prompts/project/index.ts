import type { TaskSummary } from '../task';
import { priorityLabel, statusIcon } from '../task';

export interface ProjectContextMember {
  agentId: string;
  responsibility?: string | null;
  role?: string | null;
  title?: string | null;
}

export interface ProjectContextKnowledgeBase {
  description?: string | null;
  id: string;
  name: string;
}

export interface ProjectContextTask extends TaskSummary {
  assigneeAgentId?: string | null;
}

export interface ProjectContextPromptInput {
  /**
   * Whether the coordinator gets the delegation rules. They name LobeHub task
   * tools, so a runtime without them (a CLI agent) leaves them out.
   */
  coordinationRules?: boolean;
  /** The agent this run executes as. */
  currentAgentId: string;
  knowledgeBases: ProjectContextKnowledgeBase[];
  /** Enabled members, coordinator included. */
  members: ProjectContextMember[];
  /** Open tasks (not completed or canceled), most relevant first. */
  openTasks: ProjectContextTask[];
  project: {
    coordinatorAgentId: string;
    description?: string | null;
    /** Absent for a project that numbers its tasks with the scope's default prefix. */
    identifier?: string | null;
    name: string;
    status: string;
  };
  /** Count of every open task, which may exceed `openTasks`. */
  totalOpenTasks: number;
}

const memberLabel = (member?: ProjectContextMember) =>
  member ? `${member.title || '(untitled agent)'} (${member.agentId})` : undefined;

const COORDINATOR_RULES = [
  '<coordination_rules>',
  '- You coordinate this project. Answer conversational questions yourself; do not turn every message into a task.',
  '- When the user asks for work that should be planned, split or handed off, create tasks with `createTask` / `createTasks`. Tasks you create belong to this project automatically.',
  '- Delegate by setting `assigneeAgentId` to the member whose role and responsibility fit. Only the members listed above can be assigned; leave it empty to keep the task yourself. Run a task with `runTask` when the user wants it started now.',
  "- Search the project knowledge before answering questions about the project's own material.",
  '</coordination_rules>',
];

/**
 * Live context for a run inside a project: who works here, what knowledge is
 * linked, and what is still open. Rebuilt every turn so renames and membership
 * changes never go stale; the coordinator also gets its delegation rules. The
 * context engine wraps it in `<project_context>`.
 */
export const buildProjectContextPrompt = (input: ProjectContextPromptInput): string => {
  const {
    coordinationRules = true,
    currentAgentId,
    knowledgeBases,
    members,
    openTasks,
    project,
    totalOpenTasks,
  } = input;
  const isCoordinator = project.coordinatorAgentId === currentAgentId;
  const membersById = new Map(members.map((member) => [member.agentId, member]));

  const lines: string[] = [
    `<project${project.identifier ? ` identifier="${project.identifier}"` : ''} status="${project.status}">${project.name}</project>`,
  ];
  if (project.description?.trim()) {
    lines.push(`<description>${project.description.trim()}</description>`);
  }

  lines.push('<members>');
  for (const member of members) {
    const details = [
      member.agentId === project.coordinatorAgentId ? 'coordinator' : member.role,
      member.responsibility,
    ].filter(Boolean);
    const you = member.agentId === currentAgentId ? ' [you]' : '';
    lines.push(
      `  - ${memberLabel(member)}${details.length > 0 ? `: ${details.join(' — ')}` : ''}${you}`,
    );
  }
  lines.push('</members>');

  if (knowledgeBases.length > 0) {
    lines.push(
      '<knowledge_bases hint="Searchable with the knowledge base tools by every agent in this project">',
    );
    for (const knowledgeBase of knowledgeBases) {
      const description = knowledgeBase.description?.trim();
      lines.push(
        `  - ${knowledgeBase.name} (${knowledgeBase.id})${description ? `: ${description}` : ''}`,
      );
    }
    lines.push('</knowledge_bases>');
  }

  lines.push(`<open_tasks total="${totalOpenTasks}">`);
  if (openTasks.length === 0) lines.push('  (none)');
  for (const task of openTasks) {
    const assignee = task.assigneeAgentId
      ? (memberLabel(membersById.get(task.assigneeAgentId)) ?? task.assigneeAgentId)
      : 'unassigned';
    lines.push(
      `  ${task.identifier} (id: ${task.id}) ${statusIcon(task.status)} ${task.status}  [${priorityLabel(task.priority)}]  ${task.name || '(unnamed)'} — ${assignee}`,
    );
  }
  if (totalOpenTasks > openTasks.length) {
    lines.push(`  … and ${totalOpenTasks - openTasks.length} more`);
  }
  lines.push('</open_tasks>');

  if (isCoordinator && coordinationRules) lines.push(...COORDINATOR_RULES);

  return lines.join('\n');
};
