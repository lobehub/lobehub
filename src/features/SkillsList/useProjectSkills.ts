import type { ListProjectSkillsResult, ProjectSkillItem } from '@lobechat/electron-client-ipc';
import { useCallback, useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import { useToolStore } from '@/store/tool';
import { projectSkillsSelectors } from '@/store/tool/selectors';

import type { SkillListItem } from './SkillsList';

export interface UseProjectSkillsResult {
  deviceItems: SkillListItem[];
  /** The thrown error from the latest scan, if it failed. */
  error: unknown;
  /** No scan (persisted or fresh) for this device + directory yet. */
  isLoading: boolean;
  items: SkillListItem[];
  /** Retry the failed scan. */
  mutate: () => void;
  onOpenSkill: (item: SkillListItem) => void;
  projectItems: SkillListItem[];
  raw: ListProjectSkillsResult | undefined;
}

/**
 * Shared scan + handlers for filesystem-backed skills. Project skills live
 * under `.agents/skills` / `.claude/skills` / `.codex/skills` in
 * `workingDirectory` and its parents up to the repository root; device skills
 * live under those directories in the execution device's home.
 *
 * `deviceId` picks the transport for both listing and preview: when set, the
 * scan and file reads run on that bound device via RPC (`device.listProjectSkills`
 * / `device.getLocalFilePreview`); otherwise they go through local Electron IPC.
 * Mirrors the Files tab — a bound device (remote or this machine) previews over
 * RPC rather than being non-openable.
 *
 * Pass `undefined` workingDirectory to keep the hook inert (no fetch fires) —
 * useful when the caller hasn't decided whether to render the section yet.
 */
export const useProjectSkills = (
  workingDirectory: string | undefined,
  deviceId?: string,
): UseProjectSkillsResult => {
  const openLocalFile = useChatStore((s) => s.openLocalFile);

  const { error, revalidate } = useToolStore((s) => s.useFetchProjectSkills)(
    workingDirectory,
    deviceId,
  );
  // The persisted scan paints on boot; the IPC / RPC scan replaces it once it
  // returns. `undefined` only until either one lands for this device + directory.
  const data = useToolStore(projectSkillsSelectors.getProjectSkills(workingDirectory, deviceId));
  const isLoading = !!workingDirectory && !data && !error;

  // listProjectSkills approves per-skill preview roots. Fall back to the
  // requested workingDirectory while the scan is in flight or when reading
  // legacy cached payloads without previewRoot.
  const previewRoot = data?.root || workingDirectory || '';

  const items = useMemo<SkillListItem[]>(
    () =>
      (data?.skills ?? []).map((skill) => ({
        description: skill.description,
        id: skill.skillDir,
        name: skill.name,
        scope: skill.scope,
      })),
    [data?.skills],
  );

  const projectItems = useMemo(() => items.filter((item) => item.scope !== 'device'), [items]);

  const deviceItems = useMemo(() => items.filter((item) => item.scope === 'device'), [items]);

  const skillByDir = useMemo(() => {
    const map = new Map<string, ProjectSkillItem>();
    for (const skill of data?.skills ?? []) map.set(skill.skillDir, skill);
    return map;
  }, [data?.skills]);

  // Device-scope skills live under the execution device's home
  // (`~/.agents/skills` / `~/.claude/skills`), outside the topic's project
  // scope. Marking them external both keeps the portal scope filter
  // (isLocalFileInCurrentScope) from dropping the tab and clears the desktop
  // preview protocol's approved-root / symlink-containment check
  // (resolveApprovedPreviewPath), so previews open instead of showing blank.
  const openSkillFile = useCallback(
    (skill: ProjectSkillItem, filePath: string) => {
      openLocalFile({
        // Project skills found in a parent of the working directory preview
        // against their own source directory, outside the project scope too.
        allowExternalFilePreview:
          skill.scope === 'device' || (!!skill.previewRoot && skill.previewRoot !== previewRoot),
        // A bound device (remote, or this machine as a device) reads the preview
        // over RPC, exactly like the Files tab; an undefined deviceId falls back to
        // local Electron IPC. The old `isRemote` no-op predated remote preview.
        deviceId,
        filePath,
        workingDirectory: skill.previewRoot || previewRoot,
      });
    },
    [deviceId, openLocalFile, previewRoot],
  );

  const onOpenSkill = useCallback(
    (item: SkillListItem) => {
      const skill = skillByDir.get(item.id);
      if (!skill) return;
      openSkillFile(skill, skill.path);
    },
    [openSkillFile, skillByDir],
  );

  const retry = useCallback(() => {
    void revalidate();
  }, [revalidate]);

  return {
    deviceItems,
    error,
    isLoading,
    items,
    mutate: retry,
    onOpenSkill,
    projectItems,
    raw: data,
  };
};
