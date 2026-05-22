import { type ListProjectSkillsResult, type ProjectSkillItem } from '@lobechat/electron-client-ipc';
import { Accordion, AccordionItem, Center, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import path from 'pathe';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import SkillsList, { type SkillListItem } from '@/features/AgentDocumentsExplorer/SkillsList';
import { useClientDataSWR } from '@/libs/swr';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';

const ITEM_KEY = 'project-skills';

const styles = createStaticStyles(({ css, cssVar }) => ({
  count: css`
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  empty: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  label: css`
    font-size: 12px;
    font-weight: 500;
  `,
}));

interface ProjectLevelSkillsProps {
  workingDirectory: string;
}

const ProjectLevelSkills = memo<ProjectLevelSkillsProps>(({ workingDirectory }) => {
  const { t } = useTranslation('chat');
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const [expanded, setExpanded] = useState(true);

  const { data, isLoading } = useClientDataSWR<ListProjectSkillsResult>(
    ['project-skills', workingDirectory],
    () => localFileService.listProjectSkills({ scope: workingDirectory }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  // listProjectSkills approves `data.root` for preview. Hand that exact value
  // back to openLocalFile so LocalFileProtocolManager.createPreviewUrl's
  // approved-root check matches; fall back to the requested workingDirectory
  // while the SWR fetch is in flight.
  const previewRoot = data?.root || workingDirectory;

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

  const count = items.length;

  return (
    <Accordion
      expandedKeys={expanded ? [ITEM_KEY] : []}
      gap={4}
      onExpandedChange={(keys) => setExpanded(keys.length > 0)}
    >
      <AccordionItem
        itemKey={ITEM_KEY}
        paddingBlock={2}
        paddingInline={4}
        title={
          <Flexbox horizontal align={'center'} gap={6}>
            <Text className={styles.label} type={'secondary'}>
              {t('workingPanel.skills.section.project')}
            </Text>
            {count > 0 && <span className={styles.count}>{count}</span>}
          </Flexbox>
        }
      >
        {isLoading ? (
          <Center paddingBlock={12}>
            <NeuralNetworkLoading size={24} />
          </Center>
        ) : count === 0 ? (
          <Center paddingBlock={8}>
            <Text className={styles.empty}>{t('workingPanel.skills.empty')}</Text>
          </Center>
        ) : (
          <SkillsList
            items={items}
            onOpenFile={(item, relativePath) => {
              const skill = skillByDir.get(item.id);
              if (!skill) return;
              openLocalFile({
                filePath: path.join(skill.skillDir, relativePath),
                workingDirectory: previewRoot,
              });
            }}
            onOpenSkill={(item) => {
              const skill = skillByDir.get(item.id);
              if (!skill) return;
              openLocalFile({ filePath: skill.path, workingDirectory: previewRoot });
            }}
          />
        )}
      </AccordionItem>
    </Accordion>
  );
});

ProjectLevelSkills.displayName = 'ProjectLevelSkills';

export default ProjectLevelSkills;
