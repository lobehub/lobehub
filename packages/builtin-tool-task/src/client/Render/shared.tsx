'use client';

import { ActionIcon, Block, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { PanelRight, PanelRightClose } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import AssigneeUserAvatar from '@/features/AgentTasks/features/AssigneeUserAvatar';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { useUserDisplayMeta } from '@/features/AgentTasks/shared/useUserDisplayMeta';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useTaskStore } from '@/store/task';

const styles = stylex.create({
  assignee: {
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    minWidth: 0,
    maxWidth: '100%',
  },
  assigneeName: {
    overflow: 'hidden',
    fontSize: '13px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    paddingBlock: '12px',
    paddingInline: '12px',
  },
  header: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '10px',
    paddingInline: '12px',
  },
  headerDivider: {
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
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
  inlineRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    minWidth: 0,
  },
  inlineValue: {
    overflow: 'hidden',
    flex: '1',
    minWidth: 0,
    fontSize: '13px',
    color: cssVar.colorText,
  },
  label: {
    flexShrink: 0,
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  mono: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: 0,
  },
  sectionValue: {
    fontSize: '13px',
    lineHeight: 1.6,
    color: cssVar.colorTextSecondary,
    overflowWrap: 'anywhere',
  },
  spacer: {
    flex: '1',
  },
  title: {
    fontSize: '13px',
    fontWeight: 500,
    color: cssVar.colorText,
  },
});

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

  const canonicalActive = useTaskStore((state) =>
    activeTaskDetailId ? (state.taskRefIndex[activeTaskDetailId] ?? activeTaskDetailId) : undefined,
  );
  const canonicalTarget = useTaskStore((state) =>
    identifier ? (state.taskRefIndex[identifier] ?? identifier) : undefined,
  );
  const canOpen = !!identifier;
  const isExpanded = canOpen && showTaskDetail && canonicalActive === canonicalTarget;

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
  taskId?: string;
  title: ReactNode;
}

/**
 * Outlined card shell shared by the single-task mutation renders (edit / run /
 * verify): a header line with operation icon, title and identifier chip plus an
 * optional body of detail fields. The whole card opens the task detail portal.
 */
export const TaskResultCard = memo<TaskResultCardProps>(
  ({ children, headerExtra, icon, iconColor, identifier, taskId, title }) => {
    const { t } = useTranslation('chat');
    const { canOpen, isExpanded, open, toggle } = useTaskDetailToggle(taskId ?? identifier);

    return (
      <Block
        clickable={canOpen}
        variant={'outlined'}
        width={'100%'}
        onClick={canOpen ? open : undefined}
      >
        <div {...stylex.props(styles.header, !!children && styles.headerDivider)}>
          {icon && (
            <Icon icon={icon} size={15} style={{ color: iconColor ?? cssVar.colorTextSecondary }} />
          )}
          <Text className={stylex.props(styles.title).className}>{title}</Text>
          {identifier && <span {...stylex.props(styles.identifier)}>{identifier}</span>}
          {headerExtra}
          <div {...stylex.props(styles.spacer)} />
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
        {children && <div {...stylex.props(styles.body)}>{children}</div>}
      </Block>
    );
  },
);

TaskResultCard.displayName = 'TaskResultCard';

/** A scalar detail row: muted label followed by an inline value. */
export const InlineField = memo<{ children: ReactNode; label: ReactNode }>(
  ({ children, label }) => (
    <div {...stylex.props(styles.inlineRow)}>
      <span {...stylex.props(styles.label)}>{label}</span>
      <div {...stylex.props(styles.inlineValue)}>{children}</div>
    </div>
  ),
);

InlineField.displayName = 'InlineField';

/** A stacked detail block: muted label above long-form content. */
export const SectionField = memo<{ children: ReactNode; label: ReactNode }>(
  ({ children, label }) => (
    <div {...stylex.props(styles.section)}>
      <span {...stylex.props(styles.label)}>{label}</span>
      <div {...stylex.props(styles.sectionValue)}>{children}</div>
    </div>
  ),
);

SectionField.displayName = 'SectionField';

/** An agent avatar + display name, resolved from the agent registry. */
export const AssigneeInline = memo<{ agentId: string }>(({ agentId }) => {
  const agentMeta = useAgentDisplayMeta(agentId, { fallbackToDefault: false });
  const displayName = agentMeta?.title || agentId;

  return (
    <span {...stylex.props(styles.assignee)} title={displayName}>
      <AssigneeAvatar agentId={agentId} fallbackToDefault={false} size={18} />
      <span {...stylex.props(styles.assigneeName)}>{displayName}</span>
    </span>
  );
});

AssigneeInline.displayName = 'AssigneeInline';

/** A workspace member avatar + display name — the human twin of `AssigneeInline`. */
export const MemberAssigneeInline = memo<{ userId: string }>(({ userId }) => {
  const meta = useUserDisplayMeta(userId);
  const displayName = meta?.title || userId;

  return (
    <span {...stylex.props(styles.assignee)} title={displayName}>
      <AssigneeUserAvatar size={18} userId={userId} />
      <span {...stylex.props(styles.assigneeName)}>{displayName}</span>
    </span>
  );
});

MemberAssigneeInline.displayName = 'MemberAssigneeInline';

export const monoChipStyle = styles.mono;
