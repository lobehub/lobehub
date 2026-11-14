'use client';

import type { AcceptanceCommentItem } from '@lobechat/types';
import { Button, Flexbox, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AcceptanceStatusPill from '../Header/AcceptanceStatusPill';
import { commentAuthorName, CommentAvatar } from './CommentCard';

const MAX_FACES = 8;

const styles = stylex.create({
  aside: {
    position: {
      'default': 'sticky',
      '@container (width < 720px)': 'static',
      '@media (width <= 767px)': 'static',
    },
    insetBlockStart: '20px',
    display: 'flex',
    flex: 'none',
    flexDirection: 'column',
    gap: '16px',
    width: { 'default': '296px', '@container (width < 720px)': 'auto' },
    fontSize: '13px',
    order: { 'default': null, '@media (width <= 767px)': -1 },
  },
  list: {
    display: 'grid',
    gridTemplateColumns: 'max-content minmax(0, 1fr)',
    rowGap: '12px',
    columnGap: '16px',
    alignItems: 'center',
    margin: '0',
  },
  term: { color: cssVar.colorTextTertiary },
  value: {
    overflow: 'hidden',
    minWidth: '0',
    margin: '0',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

interface DiscussionAsideProps {
  items: AcceptanceCommentItem[];
  latestRound?: number;
  onOpenChecks?: () => void;
  status?: string;
}

const DiscussionAside = memo<DiscussionAsideProps>(
  ({ items, latestRound, onOpenChecks, status }) => {
    const { t } = useTranslation('verify');

    const { approvers, faces } = useMemo(() => {
      const byAuthor = new Map<string, AcceptanceCommentItem>();
      for (const item of items) {
        if (item.deletedAt || item.kind === 'reaction') continue;
        const key = item.authorUserId ?? item.author.id ?? commentAuthorName(item.author);
        if (!byAuthor.has(key)) byAuthor.set(key, item);
      }
      return {
        approvers: items
          .filter((item) => item.kind === 'approval' && !item.deletedAt)
          .map((item) => commentAuthorName(item.author)),
        faces: [...byAuthor.values()],
      };
    }, [items]);

    return (
      <aside aria-label={t('acceptance.comments.aside.label')} {...stylex.props(styles.aside)}>
        {status && (
          <div aria-label={t('acceptance.comments.aside.status')}>
            <AcceptanceStatusPill status={status} />
          </div>
        )}
        <dl {...stylex.props(styles.list)}>
          {latestRound !== undefined && (
            <>
              <dt {...stylex.props(styles.term)}>{t('acceptance.comments.aside.round')}</dt>
              <dd {...stylex.props(styles.value)}>{latestRound}</dd>
            </>
          )}
          {faces.length > 0 && (
            <>
              <dt {...stylex.props(styles.term)}>{t('acceptance.comments.participants')}</dt>
              <dd {...stylex.props(styles.value)}>
                <Flexbox horizontal gap={4} wrap={'wrap'}>
                  {faces.slice(0, MAX_FACES).map((comment) => (
                    <Tooltip key={comment.id} title={commentAuthorName(comment.author)}>
                      <span>
                        <CommentAvatar comment={comment} size={20} />
                      </span>
                    </Tooltip>
                  ))}
                </Flexbox>
              </dd>
            </>
          )}
          {approvers.length > 0 && (
            <>
              <dt {...stylex.props(styles.term)}>{t('acceptance.comments.aside.approvals')}</dt>
              <dd {...stylex.props(styles.value)}>{approvers.join(', ')}</dd>
            </>
          )}
        </dl>
        {onOpenChecks && status === 'delivered' && (
          <Button block onClick={onOpenChecks}>
            {t('acceptance.comments.aside.decide')}
          </Button>
        )}
      </aside>
    );
  },
);

DiscussionAside.displayName = 'AcceptanceDiscussionAside';

export default DiscussionAside;
