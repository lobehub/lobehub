'use client';

import type { AcceptanceCommentItem } from '@lobechat/types';
import { createStaticStyles, cssVar, Flexbox, Text } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AcceptanceEvidence } from '../Checks/types';
import { AnnotatedImage } from '../Evidence/Annotation';
import { useAcceptanceAuthorColor } from './authorColor';

const THUMBNAIL_WIDTH = 220;
/** A long screenshot at thumbnail width would run the height of the page. */
const THUMBNAIL_MAX_HEIGHT = 240;

/**
 * How far to pull a tall thumbnail up so the circled region sits in the
 * window — the region is what the remark is about, not the top of the page.
 */
export const thumbnailCropOffset = (
  size: { height?: number | null; width?: number | null },
  rect: { height: number; y: number },
) => {
  if (!size.width || !size.height) return 0;
  const height = (THUMBNAIL_WIDTH * size.height) / size.width;
  if (height <= THUMBNAIL_MAX_HEIGHT) return 0;
  const center = (rect.y + rect.height / 2) * height;
  return Math.min(Math.max(center - THUMBNAIL_MAX_HEIGHT / 2, 0), height - THUMBNAIL_MAX_HEIGHT);
};

const styles = createStaticStyles(({ css }) => ({
  crop: css`
    overflow: hidden;
    max-height: ${THUMBNAIL_MAX_HEIGHT}px;
    border-radius: ${cssVar.borderRadius};
  `,
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
  // Imported or older evidence may carry no stored size; the picture itself
  // knows it once loaded, and until then the crop stays at the top.
  const [loaded, setLoaded] = useState<{ height: number; width: number }>();
  if (!evidence.fileUrl || !comment.rect) return null;
  const size =
    evidence.fileWidth && evidence.fileHeight
      ? { height: evidence.fileHeight, width: evidence.fileWidth }
      : loaded;

  return (
    <Flexbox className={styles.wrapper} gap={4}>
      <div className={styles.crop}>
        <div
          style={{
            marginBlockStart: -thumbnailCropOffset(size ?? {}, comment.rect),
          }}
        >
          <AnnotatedImage
            annotations={[{ color: authorColor(comment.authorUserId), rect: comment.rect }]}
            imageStyle={{ width: THUMBNAIL_WIDTH }}
            showComments={false}
            src={evidence.fileUrl}
            onLoad={(event) => {
              const { naturalHeight, naturalWidth } = event.currentTarget;
              if (naturalWidth && naturalHeight)
                setLoaded({ height: naturalHeight, width: naturalWidth });
            }}
          />
        </div>
      </div>
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
