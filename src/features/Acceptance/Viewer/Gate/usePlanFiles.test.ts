/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlanFiles } from './usePlanFiles';

const skill = vi.hoisted(() => ({ current: undefined as { files: unknown[] } | undefined }));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (key: unknown) => ({ data: key ? skill.current : undefined }),
}));
vi.mock('@/services/userSkill', () => ({ userSkillService: { get: vi.fn() } }));

const file = (path: string) => ({ content: '', path });

describe('usePlanFiles', () => {
  beforeEach(() => {
    skill.current = undefined;
  });

  // The owner asked whether the plan carries scripts or more documents: a plan
  // that does opens on its directory, with every file listed.
  it('opens the directory of a plan that ships more than SKILL.md', () => {
    skill.current = { files: [file('scripts/check.sh'), file('references/review.md')] };

    const { result } = renderHook(() => usePlanFiles('skill-1'));

    expect(result.current).toMatchObject({ extraFiles: 2, filesOpen: true });
  });

  it('reads a lone SKILL.md as a document until the owner opens the tree', () => {
    skill.current = { files: [] };
    const { result } = renderHook(() => usePlanFiles('skill-1'));
    expect(result.current).toMatchObject({ extraFiles: 0, filesOpen: false });

    act(() => result.current.toggleFiles());

    expect(result.current.filesOpen).toBe(true);
  });

  it('lets the owner fold a directory that opened on its own', () => {
    skill.current = { files: [file('scripts/check.sh')] };
    const { result } = renderHook(() => usePlanFiles('skill-1'));

    act(() => result.current.toggleFiles());

    expect(result.current.filesOpen).toBe(false);
  });
});
