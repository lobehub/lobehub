import type { SkillReferenceResolver } from './SkillReferenceResolver';
import type { VfsSkillPackageAdapter } from './VfsSkillPackageAdapter';

/**
 * Dependencies for v1.2 skill maintainer file operations.
 */
export interface SkillMaintainerServiceDeps {
  /** Adapter used for package file reads and writes. */
  adapter: VfsSkillPackageAdapter;
  /** Resolver used to turn external references into managed skill packages. */
  resolver: SkillReferenceResolver;
}

/**
 * Applies v1.2 file operations to managed skill packages.
 *
 * Use when:
 * - A hidden maintainer action needs to read or mutate one skill package file
 * - Higher-level refinement or consolidation code has already chosen the target skill
 *
 * Expects:
 * - Callers run their own policy checks before invoking mutating operations
 *
 * Returns:
 * - Completed file operations scoped under the resolved skill root
 */
export class SkillMaintainerService {
  constructor(private deps: SkillMaintainerServiceDeps) {}

  async readSkillFile(input: { path: string; skillRef: string }) {
    const skill = await this.deps.resolver.resolve(input.skillRef);

    return this.deps.adapter.read(skill, input.path);
  }

  async updateSkill(input: { content: string; path: string; skillRef: string }) {
    const skill = await this.deps.resolver.resolve(input.skillRef);

    await this.deps.adapter.read(skill, input.path);
    await this.deps.adapter.write(skill, input.path, input.content);
  }

  async writeSkillFile(input: { content: string; path: string; skillRef: string }) {
    const skill = await this.deps.resolver.resolve(input.skillRef);

    await this.deps.adapter.write(skill, input.path, input.content);
  }

  async removeSkillFile(input: { path: string; skillRef: string }) {
    const skill = await this.deps.resolver.resolve(input.skillRef);

    await this.deps.adapter.delete(skill, input.path);
  }
}
