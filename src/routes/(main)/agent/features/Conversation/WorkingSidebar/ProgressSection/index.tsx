import type { StepContextTodoStatus } from '@lobechat/types';
import { Accordion, AccordionItem, Checkbox, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { Progress } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CircleArrowRight } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';
import { useChatStore } from '@/store/chat';
import { selectTodosFromMessages } from '@/store/chat/slices/message/selectors/dbMessage';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useAgentContext } from '../../useAgentContext';
import { normalizeTaskProgress } from './taskProgressAdapter';

const styles = createStaticStyles(({ css }) => ({
  barWrap: css`
    margin-block-end: 2px;
    margin-inline: -16px;

    :where(.ant-progress-line) .ant-progress-rail {
      border-radius: 0;
    }
  `,
  chevron: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  progressBadge: css`
    color: ${cssVar.colorTextLightSolid};
  `,
  progressBadge_dark: css`
    color: ${cssVar.colorBgBase};
  `,
  progressBadge_neutral: css`
    color: ${cssVar.colorTextSecondary};
  `,
  sectionTitle: css`
    color: ${cssVar.colorTextSecondary};
  `,
  itemRow: css`
    padding-block: 6px;
    padding-inline: 0;
  `,
  processingRow: css`
    display: flex;
    gap: 7px;
    align-items: center;
  `,
  textCompleted: css`
    color: ${cssVar.colorTextSecondary};
  `,
  textProcessing: css`
    color: ${cssVar.colorTextSecondary};
  `,
  textTodo: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface ReadOnlyTodoItemProps {
  status: StepContextTodoStatus;
  text: ReactNode;
}

const ReadOnlyTodoItem = memo<ReadOnlyTodoItemProps>(({ status, text }) => {
  const isCompleted = status === 'completed';
  const isProcessing = status === 'processing';

  if (isProcessing) {
    return (
      <div className={cx(styles.itemRow, styles.processingRow)}>
        <Icon icon={CircleArrowRight} size={17} style={{ color: cssVar.colorTextSecondary }} />
        <span className={styles.textProcessing}>{text}</span>
      </div>
    );
  }

  return (
    <Checkbox
      backgroundColor={cssVar.colorSuccess}
      checked={isCompleted}
      shape={'circle'}
      style={{ borderWidth: 1.5, cursor: 'default', pointerEvents: 'none' }}
      classNames={{
        text: cx(styles.textTodo, isCompleted && styles.textCompleted),
        wrapper: styles.itemRow,
      }}
      textProps={{
        type: isCompleted ? 'secondary' : undefined,
      }}
    >
      {text}
    </Checkbox>
  );
});

ReadOnlyTodoItem.displayName = 'ReadOnlyTodoItem';

const ProgressSection = memo(() => {
  const { t } = useTranslation('chat');
  const isDarkMode = useIsDark();
  const context = useAgentContext();
  const chatKey = messageMapKey(context);
  const dbMessages = useChatStore((s) => s.dbMessagesMap[chatKey]);

  const progress = useMemo(
    () => normalizeTaskProgress(selectTodosFromMessages(dbMessages || [])),
    [dbMessages],
  );
  const hasTasks = progress.items.length > 0;

  if (!hasTasks) return null;

  return (
    <>
      <div className={styles.barWrap}>
        <Progress
          percent={progress.completionPercent}
          railColor={cssVar.colorFillTertiary}
          showInfo={false}
          strokeColor={cssVar.colorSuccess}
          strokeWidth={4}
        />
      </div>
      <Flexbox data-testid="workspace-progress" padding={16}>
        <Flexbox horizontal gap={8}>
          <Accordion defaultExpandedKeys={['progress']} gap={0}>
            <AccordionItem
              itemKey={'progress'}
              paddingBlock={2}
              paddingInline={6}
              title={<Text strong>{t('workingPanel.progress')}</Text>}
              styles={{
                header: {
                  width: 'fit-content',
                },
              }}
            >
              <div style={{ paddingTop: 2 }}>
                {progress.items.map((item, index) => (
                  <ReadOnlyTodoItem key={index} status={item.status} text={item.text} />
                ))}
              </div>
            </AccordionItem>
          </Accordion>
          <Tag
            size={'small'}
            variant={'filled'}
            style={{
              background: hasTasks ? cssVar.colorSuccess : cssVar.colorFillTertiary,
              borderRadius: 999,
              flexShrink: 0,
              minWidth: 42,
              paddingInline: 8,
              textAlign: 'center',
            }}
          >
            <span
              className={
                hasTasks
                  ? cx(styles.progressBadge, isDarkMode && styles.progressBadge_dark)
                  : styles.progressBadge_neutral
              }
            >
              {progress.completionPercent}%
            </span>
          </Tag>
        </Flexbox>
      </Flexbox>
    </>
  );
});

ProgressSection.displayName = 'ProgressSection';

export default ProgressSection;
