'use client';

import type { AcceptanceCommentItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button, Tooltip } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AcceptanceStatusPill from '../Header/AcceptanceStatusPill';
import { commentAuthorName, CommentAvatar } from './CommentCard';

const MAX_FACES = 8;

const styles = createStaticStyles(({ css }) => ({
  aside: css`
    position: sticky;
    inset-block-start: 20px;

    display: flex;
    flex: 1 1 220px;
    flex-direction: column;
    gap: 16px;

    max-width: 264px;

    font-size: 13px;

    @media (width <= 767px) {
      position: static;
      order: -1;
      max-width: none;
    }
  `,
  list: css`
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 12px 16px;
    align-items: center;

    margin: 0;
  `,
  term: css`
    color: ${cssVar.colorTextTertiary};
  `,
  value: css`
    overflow: hidden;

    min-width: 0;
    margin: 0;

    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

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
      <aside aria-label={t('acceptance.comments.aside.label')} className={styles.aside}>
        {status && (
          <div aria-label={t('acceptance.comments.aside.status')}>
            <AcceptanceStatusPill status={status} />
          </div>
        )}
        <dl className={styles.list}>
          {latestRound !== undefined && (
            <>
              <dt className={styles.term}>{t('acceptance.comments.aside.round')}</dt>
              <dd className={styles.value}>{latestRound}</dd>
            </>
          )}
          {faces.length > 0 && (
            <>
              <dt className={styles.term}>{t('acceptance.comments.participants')}</dt>
              <dd className={styles.value}>
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
              <dt className={styles.term}>{t('acceptance.comments.aside.approvals')}</dt>
              <dd className={styles.value}>{approvers.join(', ')}</dd>
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
