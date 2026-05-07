'use client';

import { priorityLabel } from '@lobechat/prompts';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { EditTaskParams, EditTaskState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  addChip: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorSuccess};

    background: ${cssVar.colorSuccessBg};
  `,
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: center;

    min-width: 0;
    max-width: 200px;
    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
  group: css`
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  `,
  identifierChip: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  label: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  removeChip: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 8px;
    border: 1px dashed ${cssVar.colorErrorBorder};
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorError};
    text-decoration: line-through;

    background: transparent;
  `,
}));

export const EditTaskInspector = memo<BuiltinInspectorProps<EditTaskParams, EditTaskState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');

    const params = args || partialArgs || ({} as Partial<EditTaskParams>);
    const identifier = params.identifier;

    const segments: { content: React.ReactNode; key: string }[] = [];

    if (params.name !== undefined) {
      segments.push({
        content: (
          <>
            <span className={styles.label}>{t('builtins.lobe-task.edit.rename')}</span>
            <span className={styles.chip}>{params.name}</span>
          </>
        ),
        key: 'name',
      });
    }

    if (params.priority !== undefined) {
      segments.push({
        content: (
          <>
            <span className={styles.label}>{t('builtins.lobe-task.edit.priority')}</span>
            <span className={styles.chip}>{priorityLabel(params.priority)}</span>
          </>
        ),
        key: 'priority',
      });
    }

    if (params.instruction !== undefined) {
      segments.push({
        content: <span className={styles.chip}>{t('builtins.lobe-task.edit.instruction')}</span>,
        key: 'instruction',
      });
    }

    if (params.description !== undefined) {
      segments.push({
        content: <span className={styles.chip}>{t('builtins.lobe-task.edit.description')}</span>,
        key: 'description',
      });
    }

    if (params.assigneeAgentId !== undefined) {
      segments.push({
        content:
          params.assigneeAgentId === null ? (
            <span className={styles.chip}>{t('builtins.lobe-task.edit.unassign')}</span>
          ) : (
            <>
              <span className={styles.label}>{t('builtins.lobe-task.edit.assign')}</span>
              <span className={styles.chip}>{params.assigneeAgentId}</span>
            </>
          ),
        key: 'assignee',
      });
    }

    if (params.addDependencies?.length) {
      segments.push({
        content: (
          <>
            <span className={styles.label}>{t('builtins.lobe-task.edit.blocksOn')}</span>
            {params.addDependencies.map((dep) => (
              <span className={styles.addChip} key={`add-${dep}`}>
                {dep}
              </span>
            ))}
          </>
        ),
        key: 'addDeps',
      });
    }

    if (params.removeDependencies?.length) {
      segments.push({
        content: (
          <>
            <span className={styles.label}>{t('builtins.lobe-task.edit.unblocks')}</span>
            {params.removeDependencies.map((dep) => (
              <span className={styles.removeChip} key={`remove-${dep}`}>
                {dep}
              </span>
            ))}
          </>
        ),
        key: 'removeDeps',
      });
    }

    return (
      <div
        style={{ flexWrap: 'wrap', gap: 6 }}
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{t('builtins.lobe-task.apiName.editTask')}</span>
        {identifier && <span className={styles.identifierChip}>{identifier}</span>}
        {segments.map((segment, index) => (
          <span className={styles.group} key={segment.key}>
            {index > 0 && <span style={{ color: cssVar.colorTextQuaternary }}>·</span>}
            {segment.content}
          </span>
        ))}
      </div>
    );
  },
);

EditTaskInspector.displayName = 'EditTaskInspector';

export default EditTaskInspector;
