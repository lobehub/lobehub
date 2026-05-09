import { SkillMaintainerExecutionRuntime } from '@lobechat/builtin-tool-skill-maintainer';
import { describe, expect, it, vi } from 'vitest';

import { SkillManagementDocumentService } from '@/server/services/skillManagement';

import { skillManagementRuntime } from '../skillManagement';

vi.mock('@/server/services/skillManagement');

describe('skillManagementRuntime', () => {
  /**
   * @example
   * The hidden skill-management runtime declares the builtin identifier used by the registry.
   */
  it('declares the skill maintainer runtime identifier', () => {
    expect(skillManagementRuntime.identifier).toBe('lobe-skill-maintainer');
  });

  /**
   * @example
   * Server runtime construction requires persistence context.
   */
  it('throws if required server context is missing', () => {
    expect(() =>
      skillManagementRuntime.factory({ serverDB: {} as never, toolManifestMap: {} }),
    ).toThrow('userId and serverDB are required for Skill Management execution');
    expect(() => skillManagementRuntime.factory({ toolManifestMap: {}, userId: 'user-1' })).toThrow(
      'userId and serverDB are required for Skill Management execution',
    );
  });

  /**
   * @example
   * The registration factory creates a package-level runtime backed by SkillManagementDocumentService.
   */
  it('constructs a SkillMaintainerExecutionRuntime', () => {
    const runtime = skillManagementRuntime.factory({
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    expect(runtime).toBeInstanceOf(SkillMaintainerExecutionRuntime);
    expect(SkillManagementDocumentService).toHaveBeenCalledWith({}, 'user-1');
  });
});
