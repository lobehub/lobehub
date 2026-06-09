// @vitest-environment node
import { builtinSkills } from '@lobechat/builtin-skills';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { filterBuiltinSkills } from '@/helpers/skillFilters';

import { ProviderSkillsBuiltin } from './ProviderSkillsBuiltin';
import { ProviderSkillsInstalledActive } from './ProviderSkillsInstalledActive';
import { ProviderSkillsInstalledAll } from './ProviderSkillsInstalledAll';

describe('readonly skill providers', () => {
  const builtinSkill = filterBuiltinSkills(builtinSkills)[0];
  const builtinSkillWithResources = filterBuiltinSkills(builtinSkills).find(
    (skill) => skill.resources && Object.keys(skill.resources).length > 0,
  );

  describe('ProviderSkillsBuiltin', () => {
    it('lists builtin skill directories at the namespace root by identifier', async () => {
      const provider = new ProviderSkillsBuiltin();

      const result = await provider.list({
        agentId: 'agent-1',
        path: './lobe/skills/builtin/skills',
        resolvedPath: {
          namespace: 'builtin',
          relativePath: '',
        },
      });

      expect(
        result.some(
          (node) =>
            node.name === builtinSkill.identifier &&
            node.path === `./lobe/skills/builtin/skills/${builtinSkill.identifier}` &&
            node.type === 'directory',
        ),
      ).toBe(true);
    });

    it('reads SKILL.md content for a builtin skill from the identifier path', async () => {
      const provider = new ProviderSkillsBuiltin();

      const result = await provider.get({
        agentId: 'agent-1',
        path: `./lobe/skills/builtin/skills/${builtinSkill.identifier}/SKILL.md`,
        resolvedPath: {
          filePath: 'SKILL.md',
          namespace: 'builtin',
          relativePath: `${builtinSkill.identifier}/SKILL.md`,
          skillName: builtinSkill.identifier,
        },
      });

      expect(result.path).toBe(`./lobe/skills/builtin/skills/${builtinSkill.identifier}/SKILL.md`);
      expect(result.content).toBe(builtinSkill.content);
      expect(result.readOnly).toBe(true);
      expect(result.size).toBe(builtinSkill.content.length);
    });

    it('projects builtin resources as first-class VFS entries when present', async () => {
      expect(builtinSkillWithResources).toBeDefined();

      const provider = new ProviderSkillsBuiltin();
      const [resourcePath] = Object.keys(builtinSkillWithResources!.resources!);
      const topLevelSegment = resourcePath.split('/')[0];

      const result = await provider.list({
        agentId: 'agent-1',
        path: `./lobe/skills/builtin/skills/${builtinSkillWithResources!.identifier}`,
        resolvedPath: {
          namespace: 'builtin',
          relativePath: builtinSkillWithResources!.identifier,
          skillName: builtinSkillWithResources!.identifier,
        },
      });

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'SKILL.md',
            path: `./lobe/skills/builtin/skills/${builtinSkillWithResources!.identifier}/SKILL.md`,
            size: builtinSkillWithResources!.content.length,
            type: 'file',
          }),
          expect.objectContaining({
            name: topLevelSegment,
            path: `./lobe/skills/builtin/skills/${builtinSkillWithResources!.identifier}/${topLevelSegment}`,
          }),
        ]),
      );
    });
  });

  describe('ProviderSkillsInstalledAll', () => {
    const skillModel = {
      findAll: vi.fn(),
      findByIdentifier: vi.fn(),
    };
    const skillResourceService = {
      readResource: vi.fn(),
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('lists installed skills from persisted storage by identifier', async () => {
      skillModel.findAll.mockResolvedValue({
        data: [{ id: 'skill-1', identifier: 'skill.one', name: 'Skill One' }],
        total: 1,
      });

      const provider = new ProviderSkillsInstalledAll({
        skillModel,
        skillResourceService,
      });
      const result = await provider.list({
        agentId: 'agent-1',
        path: './lobe/skills/installed/all/skills',
        resolvedPath: {
          namespace: 'installed-all',
          relativePath: '',
        },
      });

      expect(result).toEqual([
        expect.objectContaining({
          name: 'skill.one',
          namespace: 'installed-all',
          path: './lobe/skills/installed/all/skills/skill.one',
          type: 'directory',
        }),
      ]);
    });

    it('reads resource files through SkillResourceService', async () => {
      skillModel.findByIdentifier.mockResolvedValue({
        content: '# Skill One\n\nPersisted content.',
        id: 'skill-1',
        identifier: 'skill.one',
        name: 'Skill One',
        resources: {
          'docs/guide.md': {
            fileHash: 'hash-guide',
            size: 9,
          },
        },
      });
      skillResourceService.readResource.mockResolvedValue({
        content: '# Guide',
        encoding: 'utf8',
        fileHash: 'hash-guide',
        fileType: 'text/markdown',
        path: 'docs/guide.md',
        size: 7,
      });

      const provider = new ProviderSkillsInstalledAll({
        skillModel,
        skillResourceService,
      });
      const result = await provider.get({
        agentId: 'agent-1',
        path: './lobe/skills/installed/all/skills/skill.one/docs/guide.md',
        resolvedPath: {
          filePath: 'docs/guide.md',
          namespace: 'installed-all',
          relativePath: 'skill.one/docs/guide.md',
          skillName: 'skill.one',
        },
      });

      expect(result.content).toBe('# Guide');
      expect(result.path).toBe('./lobe/skills/installed/all/skills/skill.one/docs/guide.md');
      expect(skillResourceService.readResource).toHaveBeenCalledWith(
        {
          'docs/guide.md': {
            fileHash: 'hash-guide',
            size: 9,
          },
        },
        'docs/guide.md',
      );
    });

    it('returns resource directories as first-class VFS nodes without reading file content', async () => {
      skillModel.findByIdentifier.mockResolvedValue({
        content: '# Skill One\n\nPersisted content.',
        id: 'skill-1',
        identifier: 'skill.one',
        name: 'Skill One',
        resources: {
          'docs/guide.md': {
            fileHash: 'hash-guide',
            size: 9,
          },
        },
      });

      const provider = new ProviderSkillsInstalledAll({
        skillModel,
        skillResourceService,
      });
      const result = await provider.get({
        agentId: 'agent-1',
        path: './lobe/skills/installed/all/skills/skill.one/docs',
        resolvedPath: {
          filePath: 'docs',
          namespace: 'installed-all',
          relativePath: 'skill.one/docs',
          skillName: 'skill.one',
        },
      });

      expect(result).toEqual(
        expect.objectContaining({
          name: 'docs',
          path: './lobe/skills/installed/all/skills/skill.one/docs',
          type: 'directory',
        }),
      );
      expect(skillResourceService.readResource).not.toHaveBeenCalled();
    });
  });

  describe('ProviderSkillsInstalledActive', () => {
    const agentModel = {
      getAgentConfigById: vi.fn(),
    };
    const skillModel = {
      findAll: vi.fn(),
      findByIdentifier: vi.fn(),
    };
    const skillResourceService = {
      readResource: vi.fn(),
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('filters installed skills by the agent plugin identifiers', async () => {
      agentModel.getAgentConfigById.mockResolvedValue({
        plugins: ['skill.one'],
      });
      skillModel.findAll.mockResolvedValue({
        data: [
          { id: 'skill-1', identifier: 'skill.one', name: 'Skill One' },
          { id: 'skill-2', identifier: 'skill.two', name: 'Skill Two' },
        ],
        total: 2,
      });

      const provider = new ProviderSkillsInstalledActive({
        agentModel,
        skillModel,
        skillResourceService,
      });
      const result = await provider.list({
        agentId: 'agent-1',
        path: './lobe/skills/installed/active/skills',
        resolvedPath: {
          namespace: 'installed-active',
          relativePath: '',
        },
      });

      expect(result).toEqual([
        expect.objectContaining({
          name: 'skill.one',
          namespace: 'installed-active',
          path: './lobe/skills/installed/active/skills/skill.one',
          type: 'directory',
        }),
      ]);
    });

    it('reads SKILL.md only for active installed skills', async () => {
      agentModel.getAgentConfigById.mockResolvedValue({
        plugins: ['skill.one'],
      });
      skillModel.findByIdentifier.mockResolvedValue({
        content: '# Skill One\n\nActive content.',
        id: 'skill-1',
        identifier: 'skill.one',
        name: 'Skill One',
      });

      const provider = new ProviderSkillsInstalledActive({
        agentModel,
        skillModel,
        skillResourceService,
      });
      const result = await provider.get({
        agentId: 'agent-1',
        path: './lobe/skills/installed/active/skills/skill.one/SKILL.md',
        resolvedPath: {
          filePath: 'SKILL.md',
          namespace: 'installed-active',
          relativePath: 'skill.one/SKILL.md',
          skillName: 'skill.one',
        },
      });

      expect(result.content).toBe('# Skill One\n\nActive content.');
      expect(result.readOnly).toBe(true);
    });

    it('returns active resource directories as VFS directory nodes', async () => {
      agentModel.getAgentConfigById.mockResolvedValue({
        plugins: ['skill.one'],
      });
      skillModel.findByIdentifier.mockResolvedValue({
        content: '# Skill One\n\nActive content.',
        id: 'skill-1',
        identifier: 'skill.one',
        name: 'Skill One',
        resources: {
          'docs/guide.md': {
            fileHash: 'hash-guide',
            size: 9,
          },
        },
      });

      const provider = new ProviderSkillsInstalledActive({
        agentModel,
        skillModel,
        skillResourceService,
      });
      const result = await provider.get({
        agentId: 'agent-1',
        path: './lobe/skills/installed/active/skills/skill.one/docs',
        resolvedPath: {
          filePath: 'docs',
          namespace: 'installed-active',
          relativePath: 'skill.one/docs',
          skillName: 'skill.one',
        },
      });

      expect(result).toEqual(
        expect.objectContaining({
          name: 'docs',
          path: './lobe/skills/installed/active/skills/skill.one/docs',
          type: 'directory',
        }),
      );
      expect(skillResourceService.readResource).not.toHaveBeenCalled();
    });
  });
});
