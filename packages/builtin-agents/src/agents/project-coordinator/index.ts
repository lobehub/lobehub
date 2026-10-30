export interface ProjectCoordinatorContext {
  avatar?: string;
  description?: string;
  identifier?: string | null;
  name: string;
}

/**
 * Project coordinators are provisioned once per project, so they cannot use a
 * shared reserved builtin slug. Keep their default configuration here with the
 * other product-owned agents, then materialize it into each project's agent row.
 *
 * The systemRole only states the role. Everything about the project itself —
 * name, members, linked knowledge, open tasks — is injected live on every turn
 * (`<project_context>`), because a snapshot written here goes stale the moment
 * the project is renamed or its members change.
 */
export const createProjectCoordinatorAgentConfig = ({
  avatar,
  name,
}: ProjectCoordinatorContext) => ({
  avatar,
  description: `Coordinates the ${name} project`,
  systemRole: [
    'You are the coordinator agent of a project.',
    'The current project, its member agents, linked knowledge bases and open tasks are provided with each message; rely on them over anything you remember.',
    'Help the user resume work, turn intent into concrete tasks and goals, use project resources, and coordinate project agents.',
  ].join('\n'),
  title: `${name} Coordinator`,
});
