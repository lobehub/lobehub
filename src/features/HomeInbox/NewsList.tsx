import { Avatar, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import BriefCardArtifacts from '@/features/DailyBrief/BriefCardArtifacts';
import BriefIcon from '@/features/DailyBrief/BriefIcon';
import { type BriefItem } from '@/features/DailyBrief/types';
import Time from '@/routes/(main)/home/features/components/Time';
import { useBriefStore } from '@/store/brief';

const AVATAR_SIZE = 20;
const ROW_GAP = 10;
const ROW_PADDING_INLINE = 14;

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Line the content up under the headline, past the leading avatar.
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
    cursor: pointer;
    padding-block: 11px;
    padding-inline: ${ROW_PADDING_INLINE}px;
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
  brief: BriefItem;
}

/**
 * One non-actionable brief, collapsed to a single line. The agent that surfaced
 * it leads the row; opening it reads it (there is nothing to decide) and drops
 * the finding's detail inline.
 */
const NewsItem = memo<NewsItemProps>(({ brief }) => {
  const markBriefRead = useBriefStore((s) => s.markBriefRead);

  const [expanded, setExpanded] = useState(false);
  const [read, setRead] = useState(Boolean(brief.readAt));

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      if (!prev && !read) {
        setRead(true);
        void markBriefRead(brief.id);
      }
      return !prev;
    });
  }, [brief.id, markBriefRead, read]);

  return (
    <Flexbox className={styles.section}>
      <Flexbox horizontal align={'center'} className={styles.row} gap={ROW_GAP} onClick={toggle}>
        {brief.agent?.avatar ? (
          <Avatar
            avatar={brief.agent.avatar}
            background={brief.agent.backgroundColor || cssVar.colorBgContainer}
            shape={'circle'}
            size={AVATAR_SIZE}
            // Fade the whole row once read: the leading glyph dims with the title
            // so a scanned item recedes as one, not just a lighter headline.
            style={{ flex: 'none', opacity: read ? 0.5 : 1 }}
            title={brief.agent.title ?? undefined}
          />
        ) : (
          <BriefIcon muted={read} type={brief.type} />
        )}
        <Text
          ellipsis
          weight={read ? 400 : 500}
          style={{
            color: read ? cssVar.colorTextTertiary : undefined,
            flex: 1,
            minWidth: 0,
          }}
        >
          {brief.title}
        </Text>
        <Time date={brief.createdAt} />
        <Icon
          color={cssVar.colorTextQuaternary}
          icon={expanded ? ChevronDownIcon : ChevronRightIcon}
          size={14}
        />
      </Flexbox>

      {expanded && (brief.summary || brief.artifacts) && (
        <Flexbox className={styles.body} gap={8}>
          {brief.summary && (
            <Markdown style={{ overflow: 'unset' }} variant={'chat'}>
              {brief.summary}
            </Markdown>
          )}
          <BriefCardArtifacts artifacts={brief.artifacts} />
        </Flexbox>
      )}
    </Flexbox>
  );
});

interface NewsListProps {
  news: BriefItem[];
}

/**
 * Non-actionable briefs: the agent found something worth knowing or completed a
 * recurring run, but there is nothing to decide. One line each — the detail
 * lives behind the click, so a week of findings still fits on screen.
 */
const NewsList = memo<NewsListProps>(({ news }) => {
  if (news.length === 0) return null;

  return (
    <Flexbox className={styles.list}>
      {news.map((brief) => (
        <NewsItem brief={brief} key={brief.id} />
      ))}
    </Flexbox>
  );
});

export default NewsList;
