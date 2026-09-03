import { AGENT_CHAT_URL } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { Flexbox, Icon, Markdown } from '@lobehub/ui';
import { Avatar, Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDownIcon, ChevronRightIcon, MessageSquarePlus, Workflow } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import BriefCardArtifacts from '@/features/DailyBrief/BriefCardArtifacts';
import BriefIcon from '@/features/DailyBrief/BriefIcon';
import { type BriefItem } from '@/features/DailyBrief/types';
import { homeType } from '@/features/Home/components/homeType';
import Time from '@/features/Home/components/Time';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useBriefStore } from '@/store/brief';
import { useTaskStore } from '@/store/task';

const AVATAR_SIZE = 20;
const ROW_GAP = 10;
const ROW_PADDING_INLINE = 14;

const BARE_PADDING_INLINE = 8;
/** Past this the rail card stops being a card and starts being a page. */
const RAIL_COLLAPSED_COUNT = 6;

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Line the content up under the headline, past the leading avatar.
  bareBody: css`
    padding-block-end: 8px;
    padding-inline: ${BARE_PADDING_INLINE + AVATAR_SIZE + ROW_GAP}px ${BARE_PADDING_INLINE}px;
  `,
  // Inside a rail card the shell is already drawn; only the hover bleed remains.
  bareList: css`
    margin-inline: -${BARE_PADDING_INLINE}px;
  `,
  bareRow: css`
    padding-block: 7px;
    padding-inline: ${BARE_PADDING_INLINE}px;
    border-radius: ${cssVar.borderRadius};
  `,
  body: css`
    padding-block-end: 12px;
    padding-inline: ${ROW_PADDING_INLINE + AVATAR_SIZE + ROW_GAP}px ${ROW_PADDING_INLINE}px;
  `,
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  row: css`
    justify-content: flex-start;

    width: 100%;
    height: auto;
    padding-block: 11px;
    padding-inline: ${ROW_PADDING_INLINE}px;
    border: 0;

    text-align: start;

    transition: background ${cssVar.motionDurationFast};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  section: css`
    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
}));

interface NewsItemProps {
  bare?: boolean;
  brief: BriefItem;
  showTime: boolean;
}

/**
 * One non-actionable brief, collapsed to a single line. The agent that surfaced
 * it leads the row; opening it reads it (there is nothing to decide) and drops
 * the finding's detail inline.
 */
const NewsItem = memo<NewsItemProps>(({ bare, brief, showTime }) => {
  const { t } = useTranslation('home');
  const markBriefRead = useBriefStore((s) => s.markBriefRead);
  const navigate = useWorkspaceAwareNavigate();
  const { openTopicDrawer, setActiveTaskId } = useTaskStore(
    (s) => ({ openTopicDrawer: s.openTopicDrawer, setActiveTaskId: s.setActiveTaskId }),
    shallow,
  );

  const [expanded, setExpanded] = useState(false);
  const [localRead, setLocalRead] = useState(false);
  // Derived, not snapshotted: the day digest keeps resolved briefs in the list,
  // and a bulk mark-all-read updates them through an SWR revalidation — a
  // useState seeded from the first render would never pick that up.
  const read = localRead || Boolean(brief.readAt) || Boolean(brief.resolvedAt);

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      if (!prev && !read) {
        setLocalRead(true);
        void markBriefRead(brief.id);
      }
      return !prev;
    });
  }, [brief.id, markBriefRead, read]);

  // A run-owned brief (it names both an agent and a topic) can reopen the very
  // conversation the agent worked in; a brief without a topic can only start a
  // fresh one on the agent's chat page. Review feedback split these into two
  // actions: "View chat" opens the existing thread in place, while the primary
  // "Continue chat" stays the single call to action for both paths.
  const agentId = brief.agentId ?? brief.agent?.id;
  const hasTopicChat = Boolean(agentId && brief.topicId);
  const canContinueChat = Boolean(agentId);

  const openTopicChat = useCallback(() => {
    if (!agentId || !brief.topicId) return;
    // setActiveTaskId hydrates the drawer's task context when the brief owns
    // a task, and clears any prior drawer/task state; openTopicDrawer must
    // come after so its topic survives the reset.
    setActiveTaskId(brief.taskId ?? undefined);
    openTopicDrawer(brief.topicId, {
      agentId,
      title: brief.taskName ?? brief.title,
    });
  }, [
    agentId,
    brief.taskId,
    brief.taskName,
    brief.title,
    brief.topicId,
    openTopicDrawer,
    setActiveTaskId,
  ]);

  const handleContinueChat = useCallback(() => {
    if (!agentId) return;
    if (brief.topicId) {
      openTopicChat();
      return;
    }
    navigate(AGENT_CHAT_URL(agentId));
  }, [agentId, brief.topicId, navigate, openTopicChat]);

  return (
    <Flexbox className={bare ? undefined : styles.section}>
      <Button className={cx(styles.row, bare && styles.bareRow)} type={'text'} onClick={toggle}>
        <Flexbox horizontal align={'center'} gap={ROW_GAP} style={{ width: '100%' }}>
          {brief.agent?.avatar ? (
            <Avatar
              avatar={brief.agent.avatar}
              background={brief.agent.backgroundColor || cssVar.colorBgContainer}
              shape={'circle'}
              size={AVATAR_SIZE}
              // Fade the whole row once read: the leading glyph dims with the title
              // so a scanned item recedes as one, not just a lighter headline.
              style={{ flex: 'none', opacity: read ? 0.5 : 1 }}
              title={agentDisplayName(brief.agent)}
            />
          ) : (
            <BriefIcon muted={read} type={brief.type} />
          )}
          <Text
            ellipsis
            className={homeType.itemTitle}
            style={{
              color: read ? cssVar.colorTextTertiary : undefined,
              flex: 1,
              fontWeight: read ? 400 : undefined,
              minWidth: 0,
            }}
          >
            {brief.title}
          </Text>
          {showTime && <Time date={brief.createdAt} />}
          <Icon
            color={cssVar.colorTextQuaternary}
            icon={expanded ? ChevronDownIcon : ChevronRightIcon}
            size={14}
          />
        </Flexbox>
      </Button>

      {expanded && (brief.summary || brief.artifacts || canContinueChat) && (
        <Flexbox className={bare ? styles.bareBody : styles.body} gap={8}>
          {brief.summary && (
            <Markdown style={{ overflow: 'unset' }} variant={'chat'}>
              {brief.summary}
            </Markdown>
          )}
          <BriefCardArtifacts artifacts={brief.artifacts} />
          {canContinueChat && (
            <Flexbox horizontal align={'center'} gap={4} justify={'flex-end'}>
              {hasTopicChat && (
                <Button
                  icon={Workflow}
                  size={'small'}
                  style={{ color: cssVar.colorTextSecondary }}
                  type={'text'}
                  onClick={openTopicChat}
                >
                  {t('inbox.news.viewChat')}
                </Button>
              )}
              <Button
                icon={MessageSquarePlus}
                size={'small'}
                type={'fill'}
                onClick={handleContinueChat}
              >
                {hasTopicChat ? t('inbox.news.continueChat') : t('inbox.news.askAgent')}
              </Button>
            </Flexbox>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

interface NewsListProps {
  /** Rendered inside a rail card, which already draws the shell. */
  bare?: boolean;
  news: BriefItem[];
  /** Relative time is useful within today's feed, but redundant under a dated historical heading. */
  showTime: boolean;
}

/**
 * Non-actionable briefs: the agent found something worth knowing or completed a
 * recurring run, but there is nothing to decide. One line each — the detail
 * lives behind the click, so a week of findings still fits on screen.
 */
const NewsList = memo<NewsListProps>(({ bare, news, showTime }) => {
  const { t } = useTranslation('home');
  const [expanded, setExpanded] = useState(false);

  if (news.length === 0) return null;

  // In the rail a long feed would push every card below it off screen, so the
  // card stays a card and the tail is one click away.
  const collapsed = bare && !expanded && news.length > RAIL_COLLAPSED_COUNT;
  const shown = collapsed ? news.slice(0, RAIL_COLLAPSED_COUNT) : news;

  return (
    <Flexbox className={bare ? styles.bareList : styles.list}>
      {shown.map((brief) => (
        <NewsItem bare={bare} brief={brief} key={brief.id} showTime={showTime} />
      ))}
      {collapsed && (
        <Button
          className={cx(styles.row, styles.bareRow, homeType.supporting)}
          type={'text'}
          onClick={() => setExpanded(true)}
        >
          {t('inbox.news.showAll', { count: news.length })}
        </Button>
      )}
    </Flexbox>
  );
});

export default NewsList;
