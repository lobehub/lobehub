import { isDesktop } from '@lobechat/const';
import { type ListProjectSkillsResult, type ProjectSkillItem } from '@lobechat/electron-client-ipc';
import { Center, Empty, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { Spin } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronRightIcon, FileIcon } from 'lucide-react';
import path from 'pathe';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chevron: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
    transition: transform ${cssVar.motionDurationFast} ${cssVar.motionEaseInOut};
  `,
  chevronExpanded: css`
    transform: rotate(90deg);
  `,
  childItem: css`
    cursor: pointer;

    height: 26px;
    padding-inline: 8px;
    padding-inline-start: 32px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  childItemIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  description: css`
    max-width: 320px;
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  groupCount: css`
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  groupLabel: css`
    font-size: 12px;
    font-weight: 500;
  `,
  item: css`
    cursor: pointer;

    height: 28px;
    padding-inline: 4px 8px;
    border-radius: 6px;

    font-size: 13px;
    color: ${cssVar.colorText};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  itemCount: css`
    flex-shrink: 0;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  itemIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface SkillRowProps {
  expanded: boolean;
  onOpenFile: (relativePath: string) => void;
  onToggle: () => void;
  skill: ProjectSkillItem;
}

const SkillRow = memo<SkillRowProps>(({ expanded, onOpenFile, onToggle, skill }) => {
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const handleOpenSkill = () =>
    openLocalFile({ filePath: skill.path, workingDirectory: path.dirname(skill.skillDir) });

  return (
    <>
      <Tooltip
        placement={'left'}
        title={
          skill.description ? (
            <span className={styles.description}>{skill.description}</span>
          ) : undefined
        }
      >
        <Flexbox horizontal align={'center'} className={styles.item} gap={6}>
          <Flexbox
            align={'center'}
            justify={'center'}
            style={{ cursor: 'pointer', flexShrink: 0, height: 20, width: 20 }}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <Icon
              className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ''}`}
              icon={ChevronRightIcon}
              size={14}
            />
          </Flexbox>
          <Icon className={styles.itemIcon} icon={SkillsIcon} size={14} />
          <Text ellipsis style={{ flex: 1, minWidth: 0 }} onClick={handleOpenSkill}>
            {skill.name}
          </Text>
          <span className={styles.itemCount}>{skill.fileCount}</span>
        </Flexbox>
      </Tooltip>
      {expanded &&
        skill.files.map((relativePath) => (
          <Flexbox
            horizontal
            align={'center'}
            className={styles.childItem}
            gap={6}
            key={relativePath}
            title={relativePath}
            onClick={() => onOpenFile(relativePath)}
          >
            <Icon className={styles.childItemIcon} icon={FileIcon} size={12} />
            <Text ellipsis style={{ flex: 1, fontSize: 12, minWidth: 0 }}>
              {relativePath}
            </Text>
          </Flexbox>
        ))}
    </>
  );
});

SkillRow.displayName = 'SkillRow';

interface SkillsGroupProps {
  workingDirectory: string;
}

const SkillsGroup = memo<SkillsGroupProps>(({ workingDirectory }) => {
  const { t } = useTranslation('chat');
  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((skillDir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(skillDir)) {
        next.delete(skillDir);
      } else {
        next.add(skillDir);
      }
      return next;
    });
  }, []);

  const enabled = isDesktop && !!workingDirectory;
  const { data, error, isLoading } = useClientDataSWR<ListProjectSkillsResult>(
    enabled ? ['project-skills', workingDirectory] : null,
    () => localFileService.listProjectSkills({ scope: workingDirectory }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

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
        <Flexbox gap={2}>
          {data.skills.map((skill) => (
            <SkillRow
              expanded={expanded.has(skill.skillDir)}
              key={skill.skillDir}
              skill={skill}
              onToggle={() => toggle(skill.skillDir)}
              onOpenFile={(relativePath) =>
                openLocalFile({
                  filePath: path.join(skill.skillDir, relativePath),
                  workingDirectory: path.dirname(skill.skillDir),
                })
              }
            />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

SkillsGroup.displayName = 'SkillsGroup';

export default SkillsGroup;
