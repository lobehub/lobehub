import type { AgentRunBoardAttentionItem } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import AuthorChip from '@/features/HomeInbox/AuthorChip';
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
  detail: {
    color: cssVar.colorTextSecondary,
    fontSize: 13,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  empty: { color: cssVar.colorTextTertiary, fontSize: 13 },
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
  items,
  now,
  title,
}: {
  items: AgentRunBoardAttentionItem[];
  now: Date;
  title: string;
}) => {
  if (items.length === 0) return null;

  return (
    <Flexbox gap={4}>
      <Flexbox horizontal gap={6}>
        <span {...stylex.props(styles.heading)}>{title}</span>
        <span {...stylex.props(styles.count)}>{items.length}</span>
      </Flexbox>
      {items.map((item) => (
        <Item item={item} key={item.operationId} now={now} />
      ))}
    </Flexbox>
  );
};

const AttentionList = ({ items, now }: { items: AgentRunBoardAttentionItem[]; now: Date }) => {
  const { t } = useTranslation('home');
  const waiting = items.filter((item) => item.kind === 'needs_human');

  return (
    <Flexbox gap={16} {...stylex.props(styles.card)} data-testid={'team-board-attention'}>
      <Section
        items={waiting.filter((item) => item.isMine)}
        now={now}
        title={t('team.attention.needsYou')}
      />
      <Section
        items={waiting.filter((item) => !item.isMine)}
        now={now}
        title={t('team.attention.blocked')}
      />
      <Section
        items={items.filter((item) => item.kind === 'failed')}
        now={now}
        title={t('team.attention.failed')}
      />
      {items.length === 0 && (
        <span {...stylex.props(styles.empty)}>{t('team.attention.empty')}</span>
      )}
    </Flexbox>
  );
};

export default AttentionList;
