'use client';

import { ActionIcon, Block, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { PanelRight, PanelRightClose } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  assignee: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    min-width: 0;
    max-width: 100%;
  `,
  assigneeName: css`
    overflow: hidden;

    font-size: 13px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  body: css`
    display: flex;
    flex-direction: column;
    gap: 10px;

    padding-block: 12px;
    padding-inline: 12px;
  `,
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 10px;
    padding-inline: 12px;
  `,
  headerDivider: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
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
  inlineRow: css`
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  `,
  inlineValue: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 13px;
    color: ${cssVar.colorText};
  `,
  label: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  `,
  sectionValue: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
  `,
  spacer: css`
    flex: 1;
  `,
  title: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

/**
 * Shared open/close wiring for a task's detail portal, reused by every
 * single-task result card so clicking a card (or its toggle) reveals the full
 * task in the right-side panel.
 */
export const useTaskDetailToggle = (identifier?: string) => {
  const [activeTaskDetailId, showTaskDetail, openTaskDetail, closeTaskDetail] = useChatStore(
    (s) => [
      chatPortalSelectors.taskDetailId(s),
      chatPortalSelectors.showTaskDetail(s),
      s.openTaskDetail,
      s.closeTaskDetail,
    ],
  );

  const canOpen = !!identifier;
  const isExpanded = canOpen && showTaskDetail && activeTaskDetailId === identifier;

  const open = () => {
    if (identifier) openTaskDetail(identifier);
  };

  const toggle = () => {
    if (!identifier) return;
    if (isExpanded) closeTaskDetail();
    else openTaskDetail(identifier);
  };

  return { canOpen, isExpanded, open, toggle };
};

interface TaskResultCardProps {
  children?: ReactNode;
  /** Inline status/extra slot rendered in the header, after the identifier chip. */
  headerExtra?: ReactNode;
  icon?: LucideIcon;
  iconColor?: string;
  identifier?: string;
  title: ReactNode;
}

/**
 * Outlined card shell shared by the single-task mutation renders (edit / run /
 * verify): a header line with operation icon, title and identifier chip plus an
 * optional body of detail fields. The whole card opens the task detail portal.
 */
export const TaskResultCard = memo<TaskResultCardProps>(
  ({ children, headerExtra, icon, iconColor, identifier, title }) => {
    const { t } = useTranslation('chat');
    const { canOpen, isExpanded, open, toggle } = useTaskDetailToggle(identifier);

    return (
      <Block
        clickable={canOpen}
        variant={'outlined'}
        width={'100%'}
        onClick={canOpen ? open : undefined}
      >
        <div className={cx(styles.header, !!children && styles.headerDivider)}>
          {icon && (
            <Icon icon={icon} size={15} style={{ color: iconColor ?? cssVar.colorTextSecondary }} />
          )}
          <Text className={styles.title}>{title}</Text>
          {identifier && <span className={styles.identifier}>{identifier}</span>}
          {headerExtra}
          <div className={styles.spacer} />
          {canOpen && (
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
        {children && <div className={styles.body}>{children}</div>}
      </Block>
    );
  },
);

TaskResultCard.displayName = 'TaskResultCard';

/** A scalar detail row: muted label followed by an inline value. */
export const InlineField = memo<{ children: ReactNode; label: ReactNode }>(
  ({ children, label }) => (
    <div className={styles.inlineRow}>
      <span className={styles.label}>{label}</span>
      <div className={styles.inlineValue}>{children}</div>
    </div>
  ),
);

InlineField.displayName = 'InlineField';

/** A stacked detail block: muted label above long-form content. */
export const SectionField = memo<{ children: ReactNode; label: ReactNode }>(
  ({ children, label }) => (
    <div className={styles.section}>
      <span className={styles.label}>{label}</span>
      <div className={styles.sectionValue}>{children}</div>
    </div>
  ),
);

SectionField.displayName = 'SectionField';

/** An agent avatar + display name, resolved from the agent registry. */
export const AssigneeInline = memo<{ agentId: string }>(({ agentId }) => {
  const agentMeta = useAgentDisplayMeta(agentId, { fallbackToDefault: false });
  const displayName = agentMeta?.title || agentId;

  return (
    <span className={styles.assignee} title={displayName}>
      <AssigneeAvatar agentId={agentId} fallbackToDefault={false} size={18} />
      <span className={styles.assigneeName}>{displayName}</span>
    </span>
  );
});

AssigneeInline.displayName = 'AssigneeInline';

export const monoChipClassName = styles.mono;
