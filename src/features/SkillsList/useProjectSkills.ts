import { type ListProjectSkillsResult, type ProjectSkillItem } from '@lobechat/electron-client-ipc';
import path from 'pathe';
import { useMemo } from 'react';

import { useFetchProjectSkills } from '@/hooks/useFetchProjectSkills';
import { useChatStore } from '@/store/chat';

import type { SkillListItem } from './SkillsList';

export interface UseProjectSkillsResult {
  isLoading: boolean;
  items: SkillListItem[];
  onOpenFile: (item: SkillListItem, relativePath: string) => void;
  onOpenSkill: (item: SkillListItem) => void;
  raw: ListProjectSkillsResult | undefined;
}

/**
 * Shared SWR + handlers for filesystem-backed project skills under
 * `.agents/skills/` / `.claude/skills/` in `workingDirectory`. Powers both
 * the hetero `SkillsGroup` and the homogeneous `ProjectLevelSkills` section.
 *
 * `deviceId` picks the transport: when set, the scan runs on that remote device
 * via the `device.listProjectSkills` RPC; otherwise it goes through local
 * Electron IPC. Like the Files tab, remote mode lists skills but does not open
 * previews (the device's filesystem isn't reachable by the local viewer).
 *
 * Pass `undefined` workingDirectory to keep the hook inert (no fetch fires) —
 * useful when the caller hasn't decided whether to render the section yet.
 */
export const useProjectSkills = (
  workingDirectory: string | undefined,
  deviceId?: string,
): UseProjectSkillsResult => {
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const isRemote = !!deviceId;

  const { data, isLoading } = useFetchProjectSkills(workingDirectory, deviceId);

  // listProjectSkills approves `data.root` for preview. Hand that exact value
  // back to openLocalFile so LocalFileProtocolManager.createPreviewUrl's
  // approved-root check matches; fall back to the requested workingDirectory
  // while the SWR fetch is in flight.
  const previewRoot = data?.root || workingDirectory || '';

  const items = useMemo<SkillListItem[]>(
    () =>
      (data?.skills ?? []).map((skill) => ({
        description: skill.description,
        fileCount: skill.fileCount,
        files: skill.files,
        id: skill.skillDir,
        name: skill.name,
      })),
    [data?.skills],
  );

  const skillByDir = useMemo(() => {
    const map = new Map<string, ProjectSkillItem>();
    for (const skill of data?.skills ?? []) map.set(skill.skillDir, skill);
    return map;
  }, [data?.skills]);

  const onOpenFile = (item: SkillListItem, relativePath: string) => {
    // A remote device has no filesystem the local viewer can open (matches the
    // Files tab); device mode lists skills but does not preview them.
    if (isRemote) return;
    const skill = skillByDir.get(item.id);
    if (!skill) return;
    openLocalFile({
      filePath: path.join(skill.skillDir, relativePath),
      workingDirectory: previewRoot,
    });
  };

  const onOpenSkill = (item: SkillListItem) => {
    if (isRemote) return;
    const skill = skillByDir.get(item.id);
    if (!skill) return;
    openLocalFile({ filePath: skill.path, workingDirectory: previewRoot });
  };

  return { isLoading, items, onOpenFile, onOpenSkill, raw: data };
};
