import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { type MemoryContextStoryEvidence } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MessagesSquareIcon } from 'lucide-react';
import { memo } from 'react';

import Link from '@/libs/router/Link';

import { useStoryFormat } from '../format';

const styles = stylex.create({
  row: { columnGap: '16px', display: 'grid', gridTemplateColumns: '88px 1fr' },
  date: {
    color: cssVar.colorTextTertiary,
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '22px',
  },
  body: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
  title: { fontSize: '14px', fontWeight: 500, lineHeight: '22px', margin: 0 },
  narrative: {
    color: cssVar.colorTextSecondary,
    display: '-webkit-box',
    fontSize: '13px',
    lineHeight: '20px',
    margin: 0,
    overflow: 'hidden',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 3,
  },
  link: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    display: 'inline-flex',
    fontSize: '12px',
    gap: '4px',
    lineHeight: '20px',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

/** One conversation that moved the dossier: when, what happened, and the way back to it. */
const EvidenceRow = memo<{ evidence: MemoryContextStoryEvidence }>(({ evidence }) => {
  const format = useStoryFormat();
  const { t } = format;
  const narrative = evidence.narrative?.trim();

  return (
    <div {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.date)}>{format.day(evidence.capturedAt)}</span>
      <div {...stylex.props(styles.body)}>
        {evidence.title && <p {...stylex.props(styles.title)}>{evidence.title}</p>}
        {narrative && narrative !== evidence.title && (
          <p {...stylex.props(styles.narrative)}>{narrative}</p>
        )}
        {evidence.sourceAgentId && evidence.sourceTopicId && (
          <Link
            href={AGENT_CHAT_TOPIC_URL(evidence.sourceAgentId, evidence.sourceTopicId)}
            {...stylex.props(styles.link)}
          >
            <Icon icon={MessagesSquareIcon} size={12} />
            {evidence.sourceTopicTitle || t('story.evidence.openTopic')}
          </Link>
        )}
      </div>
    </div>
  );
});

EvidenceRow.displayName = 'StoryEvidenceRow';

export default EvidenceRow;
