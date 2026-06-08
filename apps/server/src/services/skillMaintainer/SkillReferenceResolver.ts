import type { ManagedSkillReference } from './types';

/**
 * Dependencies used to resolve external skill references.
 */
export interface SkillReferenceResolverDeps {
  /** Finds a promoted agent-level skill by id. */
  findAgentSkillById: (id: string) => Promise<{ id: string } | undefined>;
}

/**
 * Resolves skill references into package roots and mutability metadata.
 *
 * Use when:
 * - A tool call passes a skill id that points at managed agent storage
 * - Services need a single reference shape before reading or writing files
 *
 * Expects:
 * - Dependency lookups return at most one match per backing store
 *
 * Returns:
 * - A managed skill reference with VFS root and scope information
 */
export class SkillReferenceResolver {
  constructor(private deps: SkillReferenceResolverDeps) {}

  async resolve(skillRef: string): Promise<ManagedSkillReference> {
    const agentSkill = await this.deps.findAgentSkillById(skillRef);
    if (agentSkill) {
      return {
        id: agentSkill.id,
        kind: 'agent-skill',
        rootPath: `./lobe/skills/agent/skills/${agentSkill.id}`,
        scope: 'agent',
        writable: true,
      };
    }

    throw new Error(`Unknown skill reference: ${skillRef}`);
  }
}
