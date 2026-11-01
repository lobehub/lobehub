import type { ListProjectSkillsResult } from '@lobechat/electron-client-ipc';

import { defineReplica } from '@/libs/replica';

/** One filesystem skill scan target: a bound device (or the local desktop) + directory. */
export interface ProjectSkillsParams {
  /** Bound device scanned over RPC; `undefined` is the local desktop over IPC. */
  deviceId?: string;
  workingDirectory: string;
}

/**
 * How many scans stay persisted per scope. Each scan carries every skill's file
 * list (capped by the scanner), so only the recently opened device + directory
 * pairs are kept; the one on screen is pinned by its mounted `useSync`.
 */
export const MAX_PERSISTED_PROJECT_SKILL_SCANS = 20;

/** A settled scan that found nothing (or a host without a skills scanner). */
export const EMPTY_PROJECT_SKILLS: ListProjectSkillsResult = { root: '', skills: [], source: null };

export const projectSkillsKey = ({ deviceId, workingDirectory }: ProjectSkillsParams): string =>
  JSON.stringify([deviceId ?? 'local', workingDirectory]);

/**
 * The `.agents/skills` / `.claude/skills` scan of one device + directory, keyed
 * per device and directory so switching either never paints another target's
 * skills. Persisted so the working-sidebar Skills section and the `/` menu paint
 * the last scan on boot while the IPC / RPC scan confirms it.
 */
export const projectSkillsResource = defineReplica<ProjectSkillsParams, ListProjectSkillsResult>({
  key: projectSkillsKey,
  name: 'projectSkills',
  persist: { maxEntries: MAX_PERSISTED_PROJECT_SKILL_SCANS },
  storage: 'indexedDB',
  version: 1,
});
