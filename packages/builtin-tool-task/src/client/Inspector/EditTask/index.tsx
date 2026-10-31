'use client';

import { priorityLabel } from '@lobechat/prompts';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import AssigneeUserAvatar from '@/features/AgentTasks/features/AssigneeUserAvatar';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { useUserDisplayMeta } from '@/features/AgentTasks/shared/useUserDisplayMeta';
import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { EditTaskParams, EditTaskState } from '../../../types';

const styles = stylex.create({
  addChip: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorSuccess,
    background: cssVar.colorSuccessBg,
  },
  assigneeAvatar: { flexShrink: 0 },
  assigneeChip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    gap: '6px',
    alignItems: 'center',
    minWidth: '0',
    maxWidth: '220px',
    paddingBlock: '1px',
    paddingInlineStart: '4px',
    paddingInlineEnd: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    background: cssVar.colorFillTertiary,
  },
  assigneeName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    alignItems: 'center',
    minWidth: '0',
    maxWidth: '200px',
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    background: cssVar.colorFillTertiary,
  },
  group: { display: 'inline-flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' },
  identifierChip: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    background: cssVar.colorFillTertiary,
  },
  label: { flexShrink: 0, fontSize: '12px', color: cssVar.colorTextTertiary },
  removeChip: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '8px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorErrorBorder,
    borderRadius: '999px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorError,
    textDecoration: 'line-through',
    background: 'transparent',
  },
});

const AssigneeChip = memo<{ agentId: string }>(({ agentId }) => {
  const agentMeta = useAgentDisplayMeta(agentId, { fallbackToDefault: false });
  const displayName = agentMeta?.title || agentId;

  return (
    <span {...stylex.props(styles.assigneeChip)} title={displayName}>
      <span {...stylex.props(styles.assigneeAvatar)}>
        <AssigneeAvatar agentId={agentId} fallbackToDefault={false} size={16} />
      </span>
      <span {...stylex.props(styles.assigneeName)}>{displayName}</span>
    </span>
  );
});

AssigneeChip.displayName = 'AssigneeChip';

const MemberChip = memo<{ userId: string }>(({ userId }) => {
  const meta = useUserDisplayMeta(userId);
  const displayName = meta?.title || userId;

  return (
    <span {...stylex.props(styles.assigneeChip)} data-testid="member-chip" title={displayName}>
      <span {...stylex.props(styles.assigneeAvatar)}>
        <AssigneeUserAvatar size={16} userId={userId} />
      </span>
      <span {...stylex.props(styles.assigneeName)}>{displayName}</span>
    </span>
  );
});

MemberChip.displayName = 'MemberChip';

export const EditTaskInspector = memo<BuiltinInspectorProps<EditTaskParams, EditTaskState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const params = args || partialArgs || ({} as Partial<EditTaskParams>);
    const identifier = pluginState?.identifier ?? params.identifier;

    const segments: { content: ReactNode; key: string }[] = [];

    if (params.name !== undefined) {
      segments.push({
        content: (
          <>
            <span {...stylex.props(styles.label)}>{t('builtins.lobe-task.edit.rename')}</span>
            <span {...stylex.props(styles.chip)}>{params.name}</span>
          </>
        ),
        key: 'name',
      });
    }

    if (params.priority !== undefined) {
      segments.push({
        content: (
          <>
            <span {...stylex.props(styles.label)}>{t('builtins.lobe-task.edit.priority')}</span>
            <span {...stylex.props(styles.chip)}>{priorityLabel(params.priority)}</span>
          </>
        ),
        key: 'priority',
      });
    }

    if (params.instruction !== undefined) {
      segments.push({
        content: (
          <span {...stylex.props(styles.chip)}>{t('builtins.lobe-task.edit.instruction')}</span>
        ),
        key: 'instruction',
      });
    }

    if (params.description !== undefined) {
      segments.push({
        content: (
          <span {...stylex.props(styles.chip)}>{t('builtins.lobe-task.edit.description')}</span>
        ),
        key: 'description',
      });
    }

    if (params.parentIdentifier !== undefined) {
      segments.push({
        content:
          params.parentIdentifier === null ? (
            <span {...stylex.props(styles.chip)}>{t('builtins.lobe-task.edit.parentClear')}</span>
          ) : (
            <>
              <span {...stylex.props(styles.label)}>{t('builtins.lobe-task.edit.parent')}</span>
              <span {...stylex.props(styles.chip)}>{params.parentIdentifier}</span>
            </>
          ),
        key: 'parent',
      });
    }

    if (params.assigneeAgentId !== undefined || params.assigneeUserId !== undefined) {
      // Executing agent and human owner are independent sides that can change
      // (and be set) together — render a chip per assigned side; a call that
      // only clears reads as unassign.
      const hasAnyAssignee = Boolean(params.assigneeAgentId || params.assigneeUserId);
      segments.push({
        content: hasAnyAssignee ? (
          <>
            <span {...stylex.props(styles.label)}>{t('builtins.lobe-task.edit.assign')}</span>
            {params.assigneeAgentId && <AssigneeChip agentId={params.assigneeAgentId} />}
            {params.assigneeUserId && <MemberChip userId={params.assigneeUserId} />}
          </>
        ) : (
          <span {...stylex.props(styles.chip)}>{t('builtins.lobe-task.edit.unassign')}</span>
        ),
        key: 'assignee',
      });
    }

    if (params.addDependencies?.length) {
      segments.push({
        content: (
          <>
            <span {...stylex.props(styles.label)}>{t('builtins.lobe-task.edit.blocksOn')}</span>
            {params.addDependencies.map((dep) => (
              <span {...stylex.props(styles.addChip)} key={`add-${dep}`}>
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
            <span {...stylex.props(styles.label)}>{t('builtins.lobe-task.edit.unblocks')}</span>
            {params.removeDependencies.map((dep) => (
              <span {...stylex.props(styles.removeChip)} key={`remove-${dep}`}>
                {dep}
              </span>
            ))}
          </>
        ),
        key: 'removeDeps',
      });
    }

    return (
      <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
          {t('builtins.lobe-task.apiName.editTask')}
        </span>
        {identifier && <span {...stylex.props(styles.identifierChip)}>{identifier}</span>}
        {segments.map((segment, index) => (
          <span {...stylex.props(styles.group)} key={segment.key}>
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
