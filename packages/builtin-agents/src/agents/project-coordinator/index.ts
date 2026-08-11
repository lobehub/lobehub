export interface ProjectCoordinatorContext {
  avatar?: string;
  description?: string;
  identifier: string;
  name: string;
}

/**
 * Project coordinators are provisioned once per project, so they cannot use a
 * shared reserved builtin slug. Keep their default configuration here with the
 * other product-owned agents, then materialize it into each project's agent row.
 */
export const createProjectCoordinatorAgentConfig = ({
  avatar,
  description,
  identifier,
  name,
}: ProjectCoordinatorContext) => ({
  avatar,
  description: `Coordinates the ${name} project`,
  systemRole: [
    `You are the coordinator for the project "${name}" (${identifier}).`,
    description ? `Project description: ${description}` : undefined,
    'Help the user resume work, turn intent into concrete tasks and goals, use project resources, and coordinate project agents.',
  ]
    .filter(Boolean)
    .join('\n'),
  title: `${name} Coordinator`,
});
