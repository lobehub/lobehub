/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlanFiles } from './usePlanFiles';

const skill = vi.hoisted(() => ({
  current: undefined as { files: unknown[] } | undefined,
  /** Each version's package as its archive reads, by number. */
  versions: {} as Record<number, { files?: unknown[] }>,
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (key: unknown) => ({ data: key ? skill.current : undefined }),
}));
vi.mock('@/features/AgentGoals/ProcessControl/BatchPlan/skillVersions', () => ({
  useSkillVersion: (_skillId: string, version: number) => ({ data: skill.versions[version] }),
}));
vi.mock('@/services/userSkill', () => ({ userSkillService: { get: vi.fn() } }));

const file = (path: string) => ({ content: '', path });

describe('usePlanFiles', () => {
  beforeEach(() => {
    skill.current = undefined;
    skill.versions = {};
  });

  // The owner asked whether the plan carries scripts or more documents: a plan
  // that does opens on its directory, with every file listed.
  it('opens the directory of a plan that ships more than SKILL.md', () => {
    skill.current = { files: [file('scripts/check.sh'), file('references/review.md')] };

    const { result } = renderHook(() => usePlanFiles('skill-1', 1));

    expect(result.current).toMatchObject({ extraFiles: 2, filesOpen: true });
  });

  it('reads a lone SKILL.md as a document until the owner opens the tree', () => {
    skill.current = { files: [] };
    const { result } = renderHook(() => usePlanFiles('skill-1', 1));
    expect(result.current).toMatchObject({ extraFiles: 0, filesOpen: false });

    act(() => result.current.toggleFiles());

    expect(result.current.filesOpen).toBe(true);
  });

  it('lets the owner fold a directory that opened on its own', () => {
    skill.current = { files: [file('scripts/check.sh')] };
    const { result } = renderHook(() => usePlanFiles('skill-1', 1));

    act(() => result.current.toggleFiles());

    expect(result.current.filesOpen).toBe(false);
  });

  // The owner reviews one version: its package is what that version shipped,
  // not whatever the skill carries now.
  it('counts the files of the version under review', () => {
    skill.current = {
      files: [file('scripts/check.sh'), file('references/review.md'), file('templates/pr.md')],
    };
    skill.versions = { 1: { files: [] }, 2: { files: [file('scripts/check.sh')] } };

    expect(renderHook(() => usePlanFiles('skill-1', 1)).result.current).toMatchObject({
      extraFiles: 0,
      filesOpen: false,
    });
    expect(renderHook(() => usePlanFiles('skill-1', 2)).result.current.extraFiles).toBe(1);
  });
});
