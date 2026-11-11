import { useMemo } from 'react';

import { useVerifyStore, verifySelectors } from '@/store/verify';

/**
 * One version of a skill as it shipped — its `SKILL.md` and the files beside
 * it — read from its archive on demand. A version never changes, so it is
 * persisted once, painted from IndexedDB on a reload and shared by every view
 * that reads it. `data` is `null` once the server answered it has no such version.
 */
export const useSkillVersion = (skillId: string | undefined, version: number | undefined) => {
  const params = useMemo(
    () => (skillId && version ? { skillId, version } : null),
    [skillId, version],
  );
  const useFetchSkillVersion = useVerifyStore((s) => s.useFetchSkillVersion);
  const data = useVerifyStore(verifySelectors.skillVersion(params));
  const sync = useFetchSkillVersion(params);
  return {
    data,
    error: sync.error,
    isLoading: !!params && data === undefined && sync.error == null,
    mutate: sync.revalidate,
  };
};

/**
 * A plan skill from the user's library with every version it kept, shared by
 * the gate's directory, its file toggle and the batch plan's version list.
 * Paints from IndexedDB on a reload; `data` is `null` once the skill is gone.
 */
export const usePlanSkill = (skillId: string | undefined) => {
  const useFetchPlanSkill = useVerifyStore((s) => s.useFetchPlanSkill);
  const data = useVerifyStore(verifySelectors.planSkill(skillId));
  const sync = useFetchPlanSkill(skillId);
  return {
    data,
    error: sync.error,
    isLoading: !!skillId && data === undefined && sync.error == null,
    mutate: sync.revalidate,
  };
};

/**
 * The versions that failed to read and have nothing to show. Pending ones are
 * not among them, and neither is one whose text is already there.
 */
export const unreadableVersions = <T extends { body?: string; error?: unknown }>(versions: T[]) =>
  versions.filter((version) => version.body === undefined && !!version.error);
