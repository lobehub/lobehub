import { useClientDataSWR } from '@/libs/swr';
import { userSkillService } from '@/services/userSkill';

/**
 * One version of a skill as it shipped — its `SKILL.md` and the files beside
 * it — read from its archive on demand. A version never changes, so it is
 * fetched once and shared by every view that reads it.
 */
export const useSkillVersion = (skillId: string | undefined, version: number | undefined) =>
  useClientDataSWR(
    skillId && version ? ['user-skill-version', skillId, version] : null,
    () => userSkillService.getVersion(skillId!, version!),
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

/**
 * The versions that failed to read and have nothing to show. Pending ones are
 * not among them, and neither is one whose text is already there.
 */
export const unreadableVersions = <T extends { body?: string; error?: unknown }>(versions: T[]) =>
  versions.filter((version) => version.body === undefined && !!version.error);
