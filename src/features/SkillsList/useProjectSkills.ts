import type { ListProjectSkillsResult, ProjectSkillItem } from '@lobechat/electron-client-ipc';
import { EyeIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import path from 'pathe';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchProjectSkills } from '@/hooks/useFetchProjectSkills';
import { useChatStore } from '@/store/chat';

import type { SkillListItem, SkillRowAction } from './SkillsList';

export interface UseProjectSkillsResult {
  deviceItems: SkillListItem[];
  /** The thrown error from the SWR scan, if it failed. */
  error: unknown;
  /**
   * Per-row actions for filesystem skills: "view" opens the SKILL.md (local
   * only — a remote device's filesystem isn't reachable by the local viewer),
   * while rename / delete are stubbed (disabled) until filesystem-mutation IPC
   * lands.
   */
  getRowActions: (item: SkillListItem) => SkillRowAction[];
  isLoading: boolean;
  items: SkillListItem[];
  /** Retry the failed scan (SWR `mutate`). */
  mutate: () => void;
  onOpenFile: (item: SkillListItem, relativePath: string) => void;
  onOpenSkill: (item: SkillListItem) => void;
  projectItems: SkillListItem[];
  raw: ListProjectSkillsResult | undefined;
}

/**
 * Shared SWR + handlers for filesystem-backed skills. Project skills live
 * under `.agents/skills` / `.claude/skills` in `workingDirectory`; device
 * skills live under those directories in the execution device's home.
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

  // listProjectSkills approves per-skill preview roots. Fall back to the
  // requested workingDirectory while the SWR fetch is in flight or when reading
  // legacy cached payloads without previewRoot.
  const previewRoot = data?.root || workingDirectory || '';

  const items = useMemo<SkillListItem[]>(
    () =>
      (data?.skills ?? []).map((skill) => ({
        description: skill.description,
        fileCount: skill.fileCount,
        files: skill.files,
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

  const onOpenFile = (item: SkillListItem, relativePath: string) => {
    // A remote device has no filesystem the local viewer can open (matches the
    // Files tab); device mode lists skills but does not preview them.
    if (isRemote) return;
    const skill = skillByDir.get(item.id);
    if (!skill) return;
    openLocalFile({
      filePath: path.join(skill.skillDir, relativePath),
      workingDirectory: skill.previewRoot || previewRoot,
    });
  };

  const onOpenSkill = (item: SkillListItem) => {
    if (isRemote) return;
    const skill = skillByDir.get(item.id);
    if (!skill) return;
    openLocalFile({ filePath: skill.path, workingDirectory: skill.previewRoot || previewRoot });
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
    deviceItems,
    error,
    getRowActions,
    isLoading,
    items,
    mutate: () => {
      void mutate();
    },
    onOpenFile,
    onOpenSkill,
    projectItems,
    raw: data,
  };
};
