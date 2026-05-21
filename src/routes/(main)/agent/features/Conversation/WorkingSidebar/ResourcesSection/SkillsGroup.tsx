import { isDesktop } from '@lobechat/const';
import { type ListProjectSkillsResult, type ProjectSkillItem } from '@lobechat/electron-client-ipc';
import { Center, Empty, Flexbox, Text } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { Spin } from 'antd';
import { createStaticStyles } from 'antd-style';
import path from 'pathe';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import SkillsList, { type SkillListItem } from '@/features/AgentDocumentsExplorer/SkillsList';
import { useClientDataSWR } from '@/libs/swr';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';

const styles = createStaticStyles(({ css, cssVar }) => ({
  groupCount: css`
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  groupLabel: css`
    font-size: 12px;
    font-weight: 500;
  `,
}));

interface SkillsGroupProps {
  workingDirectory: string;
}

const SkillsGroup = memo<SkillsGroupProps>(({ workingDirectory }) => {
  const { t } = useTranslation('chat');
  const openLocalFile = useChatStore((s) => s.openLocalFile);

  const enabled = isDesktop && !!workingDirectory;
  const { data, error, isLoading } = useClientDataSWR<ListProjectSkillsResult>(
    enabled ? ['project-skills', workingDirectory] : null,
    () => localFileService.listProjectSkills({ scope: workingDirectory }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  // listProjectSkills approves `data.root` for preview. Hand that exact value
  // back to openLocalFile so LocalFileProtocolManager.createPreviewUrl's
  // approved-root check matches; fall back to the requested workingDirectory
  // while the SWR fetch is in flight.
  const previewWorkspaceRoot = data?.root || workingDirectory;

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

  if (!enabled) return null;

  const totalCount = data?.skills.length ?? 0;

  return (
    <Flexbox gap={4}>
      <Flexbox horizontal align={'center'} gap={6} paddingInline={4}>
        <Text className={styles.groupLabel} type={'secondary'}>
          {t('workingPanel.skills.title')}
        </Text>
        {totalCount > 0 && <span className={styles.groupCount}>{totalCount}</span>}
      </Flexbox>
      {isLoading ? (
        <Center paddingBlock={12}>
          <Spin size={'small'} />
        </Center>
      ) : error || !data || data.skills.length === 0 ? (
        <Center gap={8} paddingBlock={16}>
          <Empty description={t('workingPanel.skills.empty')} icon={SkillsIcon} />
        </Center>
      ) : (
        <SkillsList
          items={items}
          onOpenFile={(item, relativePath) => {
            const skill = skillByDir.get(item.id);
            if (!skill) return;
            openLocalFile({
              filePath: path.join(skill.skillDir, relativePath),
              workingDirectory: previewWorkspaceRoot,
            });
          }}
          onOpenSkill={(item) => {
            const skill = skillByDir.get(item.id);
            if (!skill) return;
            openLocalFile({ filePath: skill.path, workingDirectory: previewWorkspaceRoot });
          }}
        />
      )}
    </Flexbox>
  );
});

SkillsGroup.displayName = 'SkillsGroup';

export default SkillsGroup;
