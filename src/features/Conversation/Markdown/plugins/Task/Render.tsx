import type { TaskStatus } from '@lobechat/types';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ClipboardList } from 'lucide-react';
import { memo, useMemo } from 'react';

import TaskStatusIcon from '@/features/AgentTasks/features/TaskStatusIcon';

import { type MarkdownElementProps } from '../type';
import { useTaskCardScope } from './context';
import { type ParsedTaskContent, parseTaskContent } from './parseTaskContent';

const KNOWN_STATUSES: TaskStatus[] = [
  'backlog',
  'canceled',
  'completed',
  'failed',
  'paused',
  'running',
  'scheduled',
];

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    border-radius: 12px;
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
  divider: css`
    inline-size: 100%;
    block-size: 1px;
    background: ${cssVar.colorSplit};
  `,
  fallback: css`
    overflow: auto;

    padding-block: 12px;
    padding-inline: 14px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: pre-wrap;
  `,
  fieldKey: css`
    flex: none;
    min-inline-size: 64px;
    color: ${cssVar.colorTextTertiary};
  `,
  fieldRow: css`
    font-size: 13px;
    line-height: 1.6;
  `,
  fieldValue: css`
    color: ${cssVar.colorTextSecondary};
    word-break: break-word;
  `,
  headerIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    inline-size: 32px;
    block-size: 32px;
    border-radius: 8px;

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  identifier: css`
    flex: none;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  instruction: css`
    font-size: 13px;
    line-height: 1.7;
    color: ${cssVar.colorText};
    white-space: pre-wrap;
  `,
  rawList: css`
    margin: 0;
    padding: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    list-style: none;

    li {
      white-space: pre-wrap;
    }
  `,
  section: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    summary {
      cursor: pointer;
      padding-block: 4px;
      color: ${cssVar.colorTextSecondary};

      &:hover {
        color: ${cssVar.colorText};
      }
    }
  `,
}));

const isKnownStatus = (status?: string): status is TaskStatus =>
  !!status && (KNOWN_STATUSES as string[]).includes(status);

const FieldRow = memo<{ label: string; value?: string }>(({ label, value }) => {
  if (!value) return null;
  return (
    <Flexbox horizontal className={styles.fieldRow} gap={8}>
      <span className={styles.fieldKey}>{label}</span>
      <span className={styles.fieldValue}>{value}</span>
    </Flexbox>
  );
});

const RawSection = memo<{ items: string[]; label: string }>(({ items, label }) => {
  if (!items || items.length === 0) return null;
  return (
    <details className={styles.section}>
      <summary>
        {label} ({items.length})
      </summary>
      <ul className={styles.rawList}>
        {items.map((line, idx) => (
          <li key={idx}>{line}</li>
        ))}
      </ul>
    </details>
  );
});

interface TaskRenderProps extends MarkdownElementProps {
  raw?: string;
}

const Render = memo<TaskRenderProps>(({ children }) => {
  const enabled = useTaskCardScope();
  const text = typeof children === 'string' ? children : String(children ?? '');
  const parsed = useMemo<ParsedTaskContent>(() => parseTaskContent(text), [text]);

  if (!enabled) {
    return <pre className={styles.fallback}>{text}</pre>;
  }

  const titleText = parsed.name || parsed.identifier || '';

  return (
    <Block
      className={styles.container}
      gap={12}
      paddingBlock={14}
      paddingInline={16}
      variant={'outlined'}
    >
      <Flexbox horizontal align={'center'} gap={12}>
        <span className={styles.headerIcon}>
          <ClipboardList size={16} />
        </span>
        <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            {parsed.identifier && <span className={styles.identifier}>{parsed.identifier}</span>}
            <Text ellipsis weight={500}>
              {titleText}
            </Text>
          </Flexbox>
          {(parsed.status || parsed.priority) && (
            <Flexbox horizontal align={'center'} gap={8}>
              {parsed.status && (
                <Flexbox horizontal align={'center'} gap={4}>
                  {isKnownStatus(parsed.status) ? (
                    <TaskStatusIcon size={14} status={parsed.status} />
                  ) : (
                    <span style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>
                      {parsed.statusIcon}
                    </span>
                  )}
                  <Text fontSize={12} type={'secondary'}>
                    {parsed.status}
                  </Text>
                </Flexbox>
              )}
              {parsed.priority && (
                <Text fontSize={12} type={'secondary'}>
                  · Priority: {parsed.priority}
                </Text>
              )}
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>

      {parsed.instruction && (
        <>
          <div className={styles.divider} />
          <Flexbox gap={4}>
            <Text fontSize={12} type={'secondary'}>
              Instruction
            </Text>
            <div className={styles.instruction}>{parsed.instruction}</div>
          </Flexbox>
        </>
      )}

      {(parsed.description ||
        parsed.agent ||
        parsed.parent ||
        parsed.topics ||
        parsed.dependencies ||
        parsed.review) && (
        <Flexbox gap={4}>
          <FieldRow label="Description" value={parsed.description} />
          <FieldRow label="Agent" value={parsed.agent} />
          <FieldRow label="Parent" value={parsed.parent} />
          <FieldRow label="Topics" value={parsed.topics} />
          <FieldRow label="Dependencies" value={parsed.dependencies} />
          <FieldRow label="Review" value={parsed.review} />
        </Flexbox>
      )}

      {(parsed.subtasks?.length ||
        parsed.activities?.length ||
        parsed.workspace?.length ||
        parsed.reviewRubrics?.length) && (
        <Flexbox gap={4}>
          <RawSection items={parsed.subtasks ?? []} label="Subtasks" />
          <RawSection items={parsed.activities ?? []} label="Activities" />
          <RawSection items={parsed.workspace ?? []} label="Workspace" />
          <RawSection items={parsed.reviewRubrics ?? []} label="Review rubrics" />
        </Flexbox>
      )}
    </Block>
  );
});

Render.displayName = 'TaskRender';

export default Render;
