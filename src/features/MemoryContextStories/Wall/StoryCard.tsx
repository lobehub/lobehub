import { type MemoryContextStorySummary } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { useStoryFormat } from '../format';
import StatusMark from '../StatusMark';

const styles = stylex.create({
  card: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: '1px',
    boxShadow: { 'default': 'none', ':hover': cssVar.boxShadowTertiary },
    color: cssVar.colorText,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    minWidth: 0,
    paddingBlock: '16px',
    paddingInline: '16px',
    textAlign: 'start',
    transitionDuration: '0.2s',
    transitionProperty: 'border-color, box-shadow',
    transitionTimingFunction: cssVar.motionEaseInOut,
    width: '100%',
  },
  compact: { gap: '8px', paddingBlock: '12px', paddingInline: '16px' },
  eyebrow: {
    alignItems: 'center',
    color: cssVar.colorTextTertiary,
    display: 'flex',
    fontSize: '12px',
    gap: '8px',
    justifyContent: 'space-between',
    lineHeight: '18px',
  },
  span: {
    fontVariantNumeric: 'tabular-nums',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  title: {
    display: '-webkit-box',
    fontSize: '16px',
    fontWeight: 600,
    lineHeight: '24px',
    margin: 0,
    overflow: 'hidden',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
  },
  titleCompact: { fontSize: '14px', lineHeight: '22px' },
  now: {
    color: cssVar.colorTextSecondary,
    display: '-webkit-box',
    fontSize: '14px',
    lineHeight: '22px',
    margin: 0,
    overflow: 'hidden',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 3,
  },
  nowCompact: { WebkitLineClamp: 2 },
  next: {
    borderInlineStartColor: cssVar.colorPrimaryBorder,
    borderInlineStartStyle: 'solid',
    borderInlineStartWidth: '2px',
    display: '-webkit-box',
    fontSize: '14px',
    lineHeight: '22px',
    overflow: 'hidden',
    paddingInlineStart: '8px',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
  },
  nextLabel: { color: cssVar.colorTextTertiary, marginInlineEnd: '6px' },
  foot: {
    color: cssVar.colorTextTertiary,
    display: 'flex',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    gap: '8px',
    justifyContent: 'space-between',
    lineHeight: '18px',
    marginBlockStart: 'auto',
  },
});

interface StoryCardProps {
  /** Quiet and finished stories: shorter card, no next step. */
  compact?: boolean;
  onOpen: (id: string) => void;
  story: MemoryContextStorySummary;
}

/**
 * A story in one glance: how long it has run, what it is, where it stands now, and the next step.
 */
const StoryCard = memo<StoryCardProps>(({ compact, onOpen, story }) => {
  const format = useStoryFormat();
  const { t } = format;
  const span = format.span(story.firstSeenAt, story.lastEvidenceAt, story.status === 'active');
  const next = !compact ? story.nextSteps[0] : undefined;

  return (
    <button
      type={'button'}
      {...stylex.props(styles.card, compact && styles.compact)}
      onClick={() => onOpen(story.id)}
    >
      <span {...stylex.props(styles.eyebrow)}>
        <StatusMark status={story.status} />
        {span && <span {...stylex.props(styles.span)}>{span}</span>}
      </span>
      <h3 {...stylex.props(styles.title, compact && styles.titleCompact)}>
        {story.title || t('entity.untitled')}
      </h3>
      {story.now && <p {...stylex.props(styles.now, compact && styles.nowCompact)}>{story.now}</p>}
      {next && (
        <span {...stylex.props(styles.next)}>
          <span {...stylex.props(styles.nextLabel)}>{t('story.card.next')}</span>
          {next}
        </span>
      )}
      <span {...stylex.props(styles.foot)}>
        <span>
          {t('story.card.meta', { dossiers: story.dossierCount, evidence: story.evidenceCount })}
        </span>
        {story.lastEvidenceAt && <span>{format.ago(story.lastEvidenceAt)}</span>}
      </span>
    </button>
  );
});

StoryCard.displayName = 'StoryCard';

export default StoryCard;
