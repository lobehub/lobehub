'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { ActionIcon, Block, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PanelRight, PanelRightClose } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import TaskPriorityTag from '@/features/AgentTasks/features/TaskPriorityTag';
import TaskStatusTag from '@/features/AgentTasks/features/TaskStatusTag';

import { resolveTaskOpenTarget } from '../../../taskRef';
import type { CreateTaskParams, CreateTaskState } from '../../../types';
import { useTaskDetailToggle } from '../shared';

const styles = stylex.create({
  description: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '3',
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextTertiary,
  },
  identifier: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  instruction: {
    overflow: 'hidden',
    maxHeight: '132px',
    maskImage: 'linear-gradient(to bottom, black 78%, transparent)',
  },
  row: { display: 'flex', gap: '8px', alignItems: 'center' },
  taskItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    paddingBlock: '10px',
    paddingInline: '12px',
  },
  title: {
    overflow: 'hidden',
    flex: '1',
    minWidth: '0',
    fontSize: '13px',
    lineHeight: 1.4,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

export const CreateTaskRender = memo<BuiltinRenderProps<CreateTaskParams, CreateTaskState>>(
  ({ args, pluginState }) => {
    const { t } = useTranslation('chat');
    const identifier = pluginState?.identifier;
    const target = resolveTaskOpenTarget(pluginState);
    const { canOpen, isExpanded, open, toggle } = useTaskDetailToggle(target);
    // Auto-expanding the freshly created task's detail portal is driven by the
    // executor's `onAfterCall` hook (gateway `tool_end`), not a render effect —
    // see `client/executor`. The card itself only handles the manual toggle.

    // Prefer the resolved task (`pluginState`); fall back to `args` while the
    // call is still streaming and no result has landed yet.
    const name = pluginState?.name ?? args?.name;

    if (!name && !identifier) return null;

    const status = pluginState?.status;
    const priority = pluginState?.priority ?? undefined;
    const description = pluginState?.description;
    const instruction = args?.instruction;
    const parent = pluginState?.parentIdentifier ?? args?.parentIdentifier;

    return (
      <Block
        clickable={canOpen}
        variant={'outlined'}
        width={'100%'}
        onClick={canOpen ? open : undefined}
      >
        <div {...stylex.props(styles.taskItem)}>
          <div {...stylex.props(styles.row)}>
            {identifier && <span {...stylex.props(styles.identifier)}>{identifier}</span>}
            {name && <Text className={stylex.props(styles.title).className}>{name}</Text>}
            {status && <TaskStatusTag disableDropdown size={14} status={status} />}
            {!!priority && <TaskPriorityTag disableDropdown priority={priority} size={14} />}
            {identifier && (
              <ActionIcon
                active={isExpanded}
                icon={isExpanded ? PanelRightClose : PanelRight}
                size={'small'}
                title={t(isExpanded ? 'taskDetail.closeDetail' : 'taskDetail.openDetail')}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle();
                }}
              />
            )}
          </div>
          {description ? (
            <div {...stylex.props(styles.description)}>{description}</div>
          ) : instruction ? (
            <div {...stylex.props(styles.instruction)}>
              <Markdown fontSize={12} variant={'chat'}>
                {instruction}
              </Markdown>
            </div>
          ) : null}
          {parent && (
            <Text as={'span'} color={cssVar.colorTextTertiary} fontSize={11}>
              {`Subtask of ${parent}`}
            </Text>
          )}
        </div>
      </Block>
    );
  },
);

CreateTaskRender.displayName = 'CreateTaskRender';

export default CreateTaskRender;
