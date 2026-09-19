'use client';

import type { AcceptanceCommentItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AcceptanceEvidence } from '../Checks/types';
import { AnnotatedImage } from '../Evidence/Annotation';
import { useAcceptanceAuthorColor } from './authorColor';

const THUMBNAIL_WIDTH = 220;

const styles = createStaticStyles(({ css }) => ({
  caption: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  wrapper: css`
    align-self: flex-start;
  `,
}));

interface ThreadEvidenceProps {
  comment: AcceptanceCommentItem;
  evidence: AcceptanceEvidence;
  /** The round this evidence was produced in; absent when it is unknown. */
  roundIndex?: number;
  /** True once a newer round replaced what the check shows today. */
  stale: boolean;
}

/**
 * The picture the remark was written against, kept with the remark.
 *
 * A newer round swaps the evidence the check row displays, and the thread's
 * region belongs to the old image — so without this the note survives with
 * nothing to look at, and "第 3 轮那块没覆盖" becomes unreadable the moment
 * round 4 lands. The thumbnail is the thread's own copy of that moment.
 */
const ThreadEvidence = memo<ThreadEvidenceProps>(({ comment, evidence, roundIndex, stale }) => {
  const { t } = useTranslation('verify');
  const authorColor = useAcceptanceAuthorColor();
  if (!evidence.fileUrl || !comment.rect) return null;

  return (
    <Flexbox className={styles.wrapper} gap={4}>
      <AnnotatedImage
        annotations={[{ color: authorColor(comment.authorUserId), rect: comment.rect }]}
        imageStyle={{ width: THUMBNAIL_WIDTH }}
        showComments={false}
        src={evidence.fileUrl}
      />
      <span className={styles.caption}>
        {stale && roundIndex !== undefined
          ? t('acceptance.comments.evidenceFromRound', { round: roundIndex })
          : t('acceptance.comments.evidenceThisRound')}
      </span>
      {evidence.description && (
        <Text ellipsis fontSize={12} style={{ maxWidth: THUMBNAIL_WIDTH }} type={'secondary'}>
          {evidence.description}
        </Text>
      )}
    </Flexbox>
  );
});

ThreadEvidence.displayName = 'AcceptanceThreadEvidence';

export default ThreadEvidence;
