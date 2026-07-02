import { type ListProjectSkillsResult, type ProjectSkillItem } from '@lobechat/electron-client-ipc';
import { EyeIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import path from 'pathe';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchProjectSkills } from '@/hooks/useFetchProjectSkills';
import { useChatStore } from '@/store/chat';

import type { SkillListItem, SkillRowAction } from './SkillsList';

export interface UseProjectSkillsResult {
  /**
   * Per-row actions for project skills: "view" opens the SKILL.md (local only —
   * a remote device's filesystem isn't reachable by the local viewer), while
   * rename / delete are stubbed (disabled) until the filesystem-mutation IPC
   * lands.
   */
  /** The thrown error from the SWR scan, if it failed. */
  error: unknown;
  getRowActions: (item: SkillListItem) => SkillRowAction[];
  isLoading: boolean;
  items: SkillListItem[];
  /** Retry the failed scan (SWR `mutate`). */
  mutate: () => void;
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
  const { t } = useTranslation('chat');
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const isRemote = !!deviceId;

  const { data, error, isLoading, mutate } = useFetchProjectSkills(workingDirectory, deviceId);

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

  const getRowActions = (_item: SkillListItem): SkillRowAction[] => {
    const comingSoon = t('workingPanel.skills.actions.comingSoon');
    return [
      {
        // Remote devices list skills but can't preview them (matches Files tab).
        disabled: isRemote,
        icon: EyeIcon,
        key: 'view',
        label: t('workingPanel.skills.actions.view'),
        onClick: onOpenSkill,
      },
      {
        // Renaming a filesystem skill needs an IPC/RPC that doesn't exist yet.
        disabled: true,
        icon: PencilIcon,
        key: 'rename',
        label: t('workingPanel.skills.actions.rename'),
        onClick: () => {},
        tooltip: comingSoon,
      },
      {
        danger: true,
        disabled: true,
        icon: Trash2Icon,
        key: 'delete',
        label: t('workingPanel.skills.actions.delete'),
        onClick: () => {},
        tooltip: comingSoon,
      },
    ];
  };

  return {
    error,
    getRowActions,
    isLoading,
    items,
    mutate: () => {
      void mutate();
    },
    onOpenFile,
    onOpenSkill,
    raw: data,
  };
};
