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
   * Per-row actions for filesystem skills: "view" opens the SKILL.md (locally
   * via IPC, or on a bound device over RPC — same as the Files tab), while
   * rename / delete are stubbed (disabled) until filesystem-mutation IPC lands.
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
  const { t } = useTranslation('chat');
  const openLocalFile = useChatStore((s) => s.openLocalFile);

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

  // Device-scope skills live under the execution device's home
  // (`~/.agents/skills` / `~/.claude/skills`), outside the topic's project
  // scope. Marking them external both keeps the portal scope filter
  // (isLocalFileInCurrentScope) from dropping the tab and clears the desktop
  // preview protocol's approved-root / symlink-containment check
  // (resolveApprovedPreviewPath), so previews open instead of showing blank.
  const openSkillFile = (skill: ProjectSkillItem, filePath: string) => {
    openLocalFile({
      allowExternalFilePreview: skill.scope === 'device',
      // A bound device (remote, or this machine as a device) reads the preview
      // over RPC, exactly like the Files tab; an undefined deviceId falls back to
      // local Electron IPC. The old `isRemote` no-op predated remote preview.
      deviceId,
      filePath,
      workingDirectory: skill.previewRoot || previewRoot,
    });
  };

  const onOpenFile = (item: SkillListItem, relativePath: string) => {
    const skill = skillByDir.get(item.id);
    if (!skill) return;
    openSkillFile(skill, path.join(skill.skillDir, relativePath));
  };

  const onOpenSkill = (item: SkillListItem) => {
    const skill = skillByDir.get(item.id);
    if (!skill) return;
    openSkillFile(skill, skill.path);
  };

  const getRowActions = (_item: SkillListItem): SkillRowAction[] => {
    const comingSoon = t('workingPanel.skills.actions.comingSoon');
    return [
      {
        // Preview works in every mode: local via IPC, bound device via RPC
        // (matches the Files tab, which reads remote files over RPC).
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
