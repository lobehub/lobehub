import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopSkillRuntimeService } from '@/services/electron/desktopSkillRuntime';

const {
  getByIdMock,
  getByIdentifierMock,
  getByNameMock,
  getZipUrlMock,
  prepareSkillDirectoryMock,
  resolveSkillResourcePathMock,
} = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  getByIdentifierMock: vi.fn(),
  getByNameMock: vi.fn(),
  getZipUrlMock: vi.fn(),
  prepareSkillDirectoryMock: vi.fn(),
  resolveSkillResourcePathMock: vi.fn(),
}));

vi.mock('@/services/skill', () => ({
  agentSkillService: {
    getById: getByIdMock,
    getByIdentifier: getByIdentifierMock,
    getByName: getByNameMock,
    getZipUrl: getZipUrlMock,
  },
}));

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: {
    prepareSkillDirectory: prepareSkillDirectoryMock,
    resolveSkillResourcePath: resolveSkillResourcePathMock,
  },
}));

describe('desktopSkillRuntimeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should resolve an extracted directory from activated skills', async () => {
    getByIdMock.mockResolvedValue({
      id: 'skill-1',
      name: 'demo-skill',
      zipFileHash: 'zip-hash-1',
    });
    getZipUrlMock.mockResolvedValue({
      name: 'demo-skill',
      url: 'https://example.com/demo-skill.zip',
    });
    prepareSkillDirectoryMock.mockResolvedValue({
      extractedDir: '/tmp/demo-skill',
      success: true,
      zipPath: '/tmp/demo-skill.zip',
    });

    const result = await desktopSkillRuntimeService.resolveExecutionDirectory([
      { id: 'skill-1', name: 'demo-skill' },
    ]);

    expect(getByIdMock).toHaveBeenCalledWith('skill-1');
    expect(getZipUrlMock).toHaveBeenCalledWith('skill-1');
    expect(prepareSkillDirectoryMock).toHaveBeenCalledWith({
      url: 'https://example.com/demo-skill.zip',
      zipHash: 'zip-hash-1',
    });
    expect(result).toBe('/tmp/demo-skill');
  });

  it('should fall back to skill name when config id is not a persisted skill id', async () => {
    getByIdMock.mockResolvedValue(undefined);
    getByNameMock.mockResolvedValue({
      id: 'skill-1',
      name: 'demo-skill',
      zipFileHash: 'zip-hash-1',
    });
    getZipUrlMock.mockResolvedValue({
      name: 'demo-skill',
      url: 'https://example.com/demo-skill.zip',
    });
    prepareSkillDirectoryMock.mockResolvedValue({
      extractedDir: '/tmp/demo-skill',
      success: true,
      zipPath: '/tmp/demo-skill.zip',
    });

    const result = await desktopSkillRuntimeService.resolveExecutionDirectory([
      { id: 'lobe-skills-run-0', name: 'demo-skill' },
    ]);

    expect(getByIdMock).toHaveBeenCalledWith('lobe-skills-run-0');
    expect(getByNameMock).toHaveBeenCalledWith('demo-skill');
    expect(getZipUrlMock).toHaveBeenCalledWith('skill-1');
    expect(result).toBe('/tmp/demo-skill');
  });

  // id-less builtin/filesystem activations reach the desktop runtime since the
  // shared extractor keeps them — they never resolve to a packaged skill and
  // must not shadow one activated before/after them (last resolvable wins).
  it('should skip id-less unresolvable activations and use the last packaged skill', async () => {
    getByIdMock.mockResolvedValue({
      id: 'skill-1',
      name: 'demo-skill',
      zipFileHash: 'zip-hash-1',
    });
    getByNameMock.mockResolvedValue(undefined);
    getZipUrlMock.mockResolvedValue({
      name: 'demo-skill',
      url: 'https://example.com/demo-skill.zip',
    });
    prepareSkillDirectoryMock.mockResolvedValue({
      extractedDir: '/tmp/demo-skill',
      success: true,
      zipPath: '/tmp/demo-skill.zip',
    });

    const result = await desktopSkillRuntimeService.resolveExecutionDirectory([
      { name: 'builtin-skill' },
      { id: 'skill-1', name: 'demo-skill' },
      { name: 'project-skill' },
    ]);

    expect(getByNameMock).toHaveBeenCalledWith('project-skill');
    expect(getByIdMock).toHaveBeenCalledWith('skill-1');
    expect(result).toBe('/tmp/demo-skill');
    // The walk stops at the packaged skill — earlier activations are not resolved.
    expect(getByNameMock).not.toHaveBeenCalledWith('builtin-skill');
  });

  it('should prepare the most recently activated packaged skill when several resolve', async () => {
    getByIdMock.mockImplementation(async (id: string) =>
      id === 'skill-1'
        ? { id: 'skill-1', name: 'first-skill', zipFileHash: 'zip-hash-1' }
        : { id: 'skill-2', name: 'second-skill', zipFileHash: 'zip-hash-2' },
    );
    getZipUrlMock.mockResolvedValue({
      name: 'second-skill',
      url: 'https://example.com/second-skill.zip',
    });
    prepareSkillDirectoryMock.mockResolvedValue({
      extractedDir: '/tmp/second-skill',
      success: true,
      zipPath: '/tmp/second-skill.zip',
    });

    const result = await desktopSkillRuntimeService.resolveExecutionDirectory([
      { id: 'skill-1', name: 'first-skill' },
      { id: 'skill-2', name: 'second-skill' },
    ]);

    expect(getZipUrlMock).toHaveBeenCalledWith('skill-2');
    expect(result).toBe('/tmp/second-skill');
  });

  it('should return undefined when the skill has no packaged zip', async () => {
    getByIdMock.mockResolvedValue({
      id: 'skill-1',
      name: 'demo-skill',
      zipFileHash: null,
    });

    const result = await desktopSkillRuntimeService.resolveExecutionDirectory([
      { id: 'skill-1', name: 'demo-skill' },
    ]);

    expect(getZipUrlMock).not.toHaveBeenCalled();
    expect(prepareSkillDirectoryMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('should resolve the full local path for a referenced skill resource', async () => {
    getByNameMock.mockResolvedValue({
      id: 'skill-1',
      name: 'demo-skill',
      zipFileHash: 'zip-hash-1',
    });
    getZipUrlMock.mockResolvedValue({
      name: 'demo-skill',
      url: 'https://example.com/demo-skill.zip',
    });
    resolveSkillResourcePathMock.mockResolvedValue({
      fullPath: '/tmp/demo-skill/docs/bazi.py',
      success: true,
      zipPath: '/tmp/demo-skill.zip',
    });

    const result = await desktopSkillRuntimeService.resolveReferenceFullPath({
      path: 'docs/bazi.py',
      skillName: 'demo-skill',
    });

    expect(resolveSkillResourcePathMock).toHaveBeenCalledWith({
      path: 'docs/bazi.py',
      url: 'https://example.com/demo-skill.zip',
      zipHash: 'zip-hash-1',
    });
    expect(result).toBe('/tmp/demo-skill/docs/bazi.py');
  });

  // Regression for #17977 desktop exec path: /skill slash-preloaded skills
  // persist only the identifier (no DB id), and the identifier may differ from
  // the DB display name. resolveSkill must resolve them by identifier so
  // execScript gets the skill's extracted directory as cwd.
  it('should resolve a slash-preloaded skill by identifier (no DB id)', async () => {
    getByIdMock.mockResolvedValue(undefined);
    getByIdentifierMock.mockResolvedValue({
      id: 'marketing-skill-id',
      identifier: 'marketing-adapter',
      name: 'Multi-Size Marketing Adapter',
      zipFileHash: 'zip-hash-2',
    });
    getZipUrlMock.mockResolvedValue({
      name: 'Multi-Size Marketing Adapter',
      url: 'https://example.com/marketing.zip',
    });
    prepareSkillDirectoryMock.mockResolvedValue({
      extractedDir: '/tmp/marketing-adapter',
      success: true,
      zipPath: '/tmp/marketing-adapter.zip',
    });

    const result = await desktopSkillRuntimeService.resolveExecutionDirectory([
      { identifier: 'marketing-adapter', name: 'marketing-adapter' },
    ]);

    expect(getByIdentifierMock).toHaveBeenCalledWith('marketing-adapter');
    expect(getByNameMock).not.toHaveBeenCalled();
    expect(getZipUrlMock).toHaveBeenCalledWith('marketing-skill-id');
    expect(result).toBe('/tmp/marketing-adapter');
  });

  // Regression: a slash-preloaded skill's identifier may collide with another
  // skill's DB display name. identifier must be the primary lookup key so the
  // wrong package is never extracted/executed.
  it('should resolve by identifier even when another skill shares that identifier as its name', async () => {
    getByIdMock.mockResolvedValue(undefined);
    // A DIFFERENT skill whose display name collides with the target identifier.
    getByNameMock.mockResolvedValue({
      id: 'colliding-skill-id',
      identifier: 'colliding-adapter',
      name: 'marketing-adapter',
      zipFileHash: 'colliding-zip-hash',
    });
    getByIdentifierMock.mockResolvedValue({
      id: 'marketing-skill-id',
      identifier: 'marketing-adapter',
      name: 'Multi-Size Marketing Adapter',
      zipFileHash: 'zip-hash-2',
    });
    getZipUrlMock.mockResolvedValue({
      name: 'Multi-Size Marketing Adapter',
      url: 'https://example.com/marketing.zip',
    });
    prepareSkillDirectoryMock.mockResolvedValue({
      extractedDir: '/tmp/marketing-adapter',
      success: true,
      zipPath: '/tmp/marketing-adapter.zip',
    });

    const result = await desktopSkillRuntimeService.resolveExecutionDirectory([
      { identifier: 'marketing-adapter', name: 'marketing-adapter' },
    ]);

    // identifier-first: the colliding skill is never looked up by name.
    expect(getByIdentifierMock).toHaveBeenCalledWith('marketing-adapter');
    expect(getByNameMock).not.toHaveBeenCalled();
    expect(getZipUrlMock).toHaveBeenCalledWith('marketing-skill-id');
    expect(result).toBe('/tmp/marketing-adapter');
  });
});
