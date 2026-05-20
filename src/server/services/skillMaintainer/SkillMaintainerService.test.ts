import { describe, expect, it, vi } from 'vitest';

import { SkillMaintainerService } from './SkillMaintainerService';
import type { SkillReferenceResolver } from './SkillReferenceResolver';
import type { ManagedSkillReference } from './types';
import type { VfsSkillPackageAdapter } from './VfsSkillPackageAdapter';

describe('SkillMaintainerService', () => {
  it('reads a managed skill file through the VFS adapter', async () => {
    const skill = { rootPath: './root', writable: true } as ManagedSkillReference;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(skill),
    } as unknown as SkillReferenceResolver;
    const adapter = {
      read: vi.fn().mockResolvedValue('# Skill'),
    } as unknown as VfsSkillPackageAdapter;
    const service = new SkillMaintainerService({ adapter, resolver });

    const content = await service.readSkillFile({
      path: 'SKILL.md',
      skillRef: 'agent-skill-1',
    });

    expect(content).toBe('# Skill');
    expect(adapter.read).toHaveBeenCalledWith(skill, 'SKILL.md');
  });

  it('updates only an existing managed skill file', async () => {
    const skill = { rootPath: './root', writable: true } as ManagedSkillReference;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(skill),
    } as unknown as SkillReferenceResolver;
    const adapter = {
      read: vi.fn().mockResolvedValue('old'),
      write: vi.fn(),
    } as unknown as VfsSkillPackageAdapter;
    const service = new SkillMaintainerService({ adapter, resolver });

    await service.updateSkill({
      content: 'new',
      path: 'SKILL.md',
      skillRef: 'agent-skill-1',
    });

    expect(adapter.read).toHaveBeenCalledWith(skill, 'SKILL.md');
    expect(adapter.write).toHaveBeenCalledWith(skill, 'SKILL.md', 'new');
  });

  it('writes and removes package-relative skill files', async () => {
    const skill = { rootPath: './root', writable: true } as ManagedSkillReference;
    const resolver = {
      resolve: vi.fn().mockResolvedValue(skill),
    } as unknown as SkillReferenceResolver;
    const adapter = {
      delete: vi.fn(),
      write: vi.fn(),
    } as unknown as VfsSkillPackageAdapter;
    const service = new SkillMaintainerService({ adapter, resolver });

    await service.writeSkillFile({
      content: 'reference',
      path: 'references/guide.md',
      skillRef: 'agent-skill-1',
    });
    await service.removeSkillFile({
      path: 'references/guide.md',
      skillRef: 'agent-skill-1',
    });

    expect(adapter.write).toHaveBeenCalledWith(skill, 'references/guide.md', 'reference');
    expect(adapter.delete).toHaveBeenCalledWith(skill, 'references/guide.md');
  });
});
