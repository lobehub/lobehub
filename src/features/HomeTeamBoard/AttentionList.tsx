import type { AgentRunBoardAttentionItem } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PanelRightCloseIcon, PanelRightOpenIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import AuthorChip from '@/features/HomeInbox/AuthorChip';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { sx } from '@/styles/sx';

import { formatDuration } from './layout';
import { RUN_STATUS_VISUALS } from './statusVisuals';
import { useOpenRunDrawer } from './useOpenRunDrawer';

const styles = stylex.create({
  action: {
    color: cssVar.colorPrimary,
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  card: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 12,
    borderStyle: 'solid',
    borderWidth: 1,
    paddingBlock: 16,
    paddingInline: 16,
  },
  count: { color: cssVar.colorTextTertiary, fontSize: 12 },
  // Folded: a slim column that still says how much is waiting, so putting the
  // list away never hides that something is stuck.
  rail: {
    alignItems: 'center',
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorFillQuaternary },
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 12,
    borderStyle: 'solid',
    borderWidth: 1,
    color: cssVar.colorTextSecondary,
    cursor: 'pointer',
    // Below the board's breakpoint the list wraps under the timeline, so
    // folding saves no width there: the full card shows instead.
    display: { 'default': 'flex', '@media (max-width: 1100px)': 'none' },
    flexDirection: 'column',
    gap: 12,
    paddingBlock: 12,
    paddingInline: 0,
    width: '100%',
  },
  // Same breakpoint as the board's grid in `index.tsx`.
  narrowOnly: { display: { 'default': 'none', '@media (max-width: 1100px)': 'block' } },
  wideOnly: { display: { 'default': 'inline-flex', '@media (max-width: 1100px)': 'none' } },
  railCount: {
    alignItems: 'center',
    display: 'flex',
    flexDirection: 'column',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    gap: 2,
  },
  detail: {
    color: cssVar.colorTextSecondary,
    fontSize: 13,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  heading: { color: cssVar.colorTextTertiary, fontSize: 12, fontWeight: 500 },
  item: {
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillQuaternary },
    borderRadius: 8,
    borderStyle: 'none',
    borderWidth: 0,
    color: 'inherit',
    cursor: { 'default': 'pointer', ':disabled': 'default' },
    display: 'block',
    marginInline: -8,
    paddingBlock: 8,
    paddingInline: 8,
    textAlign: 'start',
    width: 'calc(100% + 16px)',
  },
  meta: { flexShrink: 0, fontSize: 12, whiteSpace: 'nowrap' },
});

const Item = ({ item, now }: { item: AgentRunBoardAttentionItem; now: Date }) => {
  const { t } = useTranslation('home');
  const openDrawer = useOpenRunDrawer();
  const failed = item.kind === 'failed';
  const canAct = item.isMine && !failed;
  const elapsed = formatDuration(now.getTime() - item.since.getTime());
  const title = item.title || t('team.run.untitled');

  return (
    <button
      data-testid={`team-board-attention-${item.kind}`}
      disabled={!item.topicId}
      type={'button'}
      {...stylex.props(styles.item)}
      onClick={() =>
        openDrawer({
          agentId: item.agentId,
          runningOperation: item.runningOperation,
          title,
          topicId: item.topicId,
        })
      }
    >
      <Flexbox gap={4}>
        <Flexbox horizontal align={'center'} gap={8}>
          <AgentAvatar
            agentId={item.agentId}
            avatar={item.agentAvatar ?? undefined}
            background={item.agentBackgroundColor ?? undefined}
            name={item.agentTitle ?? undefined}
            size={20}
          />
          <Text ellipsis style={{ flex: 1 }} weight={500}>
            {title}
          </Text>
          {!item.isMine && <AuthorChip avatarOnly userId={item.ownerUserId} />}
          <span
            {...sx(styles.meta, {
              color: RUN_STATUS_VISUALS[failed ? 'failed' : 'needs_human'].color,
            })}
          >
            {t(failed ? 'team.attention.failedAgo' : 'team.attention.waiting', { time: elapsed })}
          </span>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <span {...stylex.props(styles.detail)}>
            {failed ? item.detail : t('team.attention.approvalNeeded')}
          </span>
          {/* A span: the whole row is the button, and the drawer holds the approval card. */}
          <span {...stylex.props(styles.action)} data-testid={'team-board-attention-action'}>
            {t(canAct ? 'team.attention.handle' : 'team.attention.view')}
          </span>
        </Flexbox>
      </Flexbox>
    </button>
  );
};

const Section = ({
  action,
  items,
  now,
  title,
}: {
  action?: ReactNode;
  items: AgentRunBoardAttentionItem[];
  now: Date;
  title: string;
}) => (
  <Flexbox gap={4}>
    <Flexbox horizontal align={'center'} gap={6}>
      <span {...stylex.props(styles.heading)}>{title}</span>
      <span {...stylex.props(styles.count)}>{items.length}</span>
      {action && <div style={{ marginInlineStart: 'auto' }}>{action}</div>}
    </Flexbox>
    {items.map((item) => (
      <Item item={item} key={item.operationId} now={now} />
    ))}
  </Flexbox>
);

const AttentionList = ({ items, now }: { items: AgentRunBoardAttentionItem[]; now: Date }) => {
  const { t } = useTranslation('home');
  const collapsed = useGlobalStore(systemStatusSelectors.teamBoardAttentionCollapsed);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const setCollapsed = (next: boolean) =>
    updateSystemStatus({ teamBoardAttentionCollapsed: next }, 'toggleTeamBoardAttention');

  const waiting = items.filter((item) => item.kind === 'needs_human');
  const failed = items.filter((item) => item.kind === 'failed');

  const sections = [
    { items: waiting.filter((item) => item.isMine), title: t('team.attention.needsYou') },
    { items: waiting.filter((item) => !item.isMine), title: t('team.attention.blocked') },
    { items: failed, title: t('team.attention.failed') },
  ].filter((section) => section.items.length > 0);

  const card = (
    <Flexbox gap={16} {...stylex.props(styles.card)} data-testid={'team-board-attention'}>
      {sections.map((section, index) => (
        <Section
          items={section.items}
          key={section.title}
          now={now}
          title={section.title}
          action={
            // The fold control rides on the first heading instead of adding a header row.
            index === 0 && (
              <span {...stylex.props(styles.wideOnly)}>
                <ActionIcon
                  data-testid={'team-board-attention-collapse'}
                  icon={PanelRightCloseIcon}
                  size={'small'}
                  title={t('team.attention.collapse')}
                  onClick={() => setCollapsed(true)}
                />
              </span>
            )
          }
        />
      ))}
    </Flexbox>
  );

  if (!collapsed) return card;

  const counts = [
    { count: waiting.length, status: 'needs_human' as const },
    { count: failed.length, status: 'failed' as const },
  ].filter(({ count }) => count > 0);

  // Both render; CSS picks one by width, so a fold made on a wide screen
  // never hides the list on a narrow one.
  return (
    <>
      <Tooltip placement={'left'} title={t('team.attention.expand')}>
        <button
          aria-label={t('team.attention.expand')}
          data-testid={'team-board-attention-rail'}
          type={'button'}
          {...stylex.props(styles.rail)}
          onClick={() => setCollapsed(false)}
        >
          <Icon icon={PanelRightOpenIcon} size={16} />
          {counts.map(({ count, status }) => (
            <span
              data-testid={`team-board-attention-rail-${status}`}
              key={status}
              {...sx(styles.railCount, { color: RUN_STATUS_VISUALS[status].color })}
            >
              <Icon icon={RUN_STATUS_VISUALS[status].icon} size={14} />
              {count}
            </span>
          ))}
        </button>
      </Tooltip>
      <div {...stylex.props(styles.narrowOnly)}>{card}</div>
    </>
  );
};

export default AttentionList;
