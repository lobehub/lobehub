'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { ActionIcon, Block, Markdown, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { PanelRight, PanelRightClose } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import TaskPriorityTag from '@/features/AgentTasks/features/TaskPriorityTag';
import TaskStatusTag from '@/features/AgentTasks/features/TaskStatusTag';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import type { CreateTaskParams, CreateTaskState } from '../../../types';

// Tracks task identifiers we've already auto-expanded so re-mounting the card
// (scrolling the message back into view) doesn't reopen a portal the user closed.
const autoOpened = new Set<string>();

const styles = createStaticStyles(({ css, cssVar }) => ({
  description: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
  `,
  identifier: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  instruction: css`
    /* The instruction is model-facing markdown; render it as a faded preview
       rather than flattening it to plain text. Full content lives in the
       expanded detail panel. */
    overflow: hidden;
    max-height: 132px;

    mask-image: linear-gradient(to bottom, black 78%, transparent);

    mask-image: linear-gradient(to bottom, black 78%, transparent);
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  taskItem: css`
    display: flex;
    flex-direction: column;
    gap: 6px;

    padding-block: 10px;
    padding-inline: 12px;
  `,
  title: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 13px;
    line-height: 1.4;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

export const CreateTaskRender = memo<BuiltinRenderProps<CreateTaskParams, CreateTaskState>>(
  ({ args, pluginState }) => {
    const { t } = useTranslation('chat');
    const [activeTaskDetailId, showTaskDetail, openTaskDetail, closeTaskDetail] = useChatStore(
      (s) => [
        chatPortalSelectors.taskDetailId(s),
        chatPortalSelectors.showTaskDetail(s),
        s.openTaskDetail,
        s.closeTaskDetail,
      ],
    );

    const identifier = pluginState?.identifier;
    // Identifier present at first render means this card mounted already-resolved
    // (e.g. an old task when reopening the conversation) — only the fresh
    // undefined → defined transition counts as "just created".
    const identifierAtMount = useRef(identifier);

    // Once the task is freshly created, auto-expand its detail in the right-side
    // portal so the user can review it without leaving the conversation.
    useEffect(() => {
      if (!identifier || identifierAtMount.current === identifier) return;
      if (autoOpened.has(identifier)) return;
      autoOpened.add(identifier);
      openTaskDetail(identifier);
    }, [identifier, openTaskDetail]);

    // Prefer the resolved task (`pluginState`); fall back to `args` while the
    // call is still streaming and no result has landed yet.
    const name = pluginState?.name ?? args?.name;

    if (!name && !identifier) return null;

    const status = pluginState?.status;
    const priority = pluginState?.priority ?? undefined;
    const description = pluginState?.description;
    const instruction = args?.instruction;
    const parent = pluginState?.parentIdentifier ?? args?.parentIdentifier;
    const isExpanded = !!identifier && showTaskDetail && activeTaskDetailId === identifier;

    const toggle = () => {
      if (!identifier) return;
      if (isExpanded) closeTaskDetail();
      else openTaskDetail(identifier);
    };

    return (
      <Block
        clickable={!!identifier}
        variant={'outlined'}
        width={'100%'}
        onClick={identifier ? () => openTaskDetail(identifier) : undefined}
      >
        <div className={styles.taskItem}>
          <div className={styles.row}>
            {identifier && <span className={styles.identifier}>{identifier}</span>}
            {name && <Text className={styles.title}>{name}</Text>}
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
            <div className={styles.description}>{description}</div>
          ) : instruction ? (
            <div className={styles.instruction}>
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
