'use client';

import type { DocumentReviewTextAnchor } from '@lobechat/types';
import { Block, cssVar, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { CornerDownRightIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ReviewQuoteProps {
  anchor?: DocumentReviewTextAnchor | null;
  label: string;
  onJump?: () => void;
}

/**
 * One original-text excerpt. A quote that could no longer be found keeps the
 * text the model quoted but loses its jump: the reader still needs to judge
 * whether the finding is stale, and hiding it would hide the evidence.
 */
const ReviewQuote = memo<ReviewQuoteProps>(({ anchor, label, onJump }) => {
  const { t } = useTranslation('file');
  if (!anchor?.quote) return null;

  const invalid = Boolean(anchor.invalid);
  const clickable = !invalid && Boolean(onJump);

  return (
    <Block
      clickable={clickable}
      gap={2}
      paddingBlock={6}
      paddingInline={8}
      variant={'borderless'}
      style={{
        borderInlineStart: `2px solid ${cssVar.colorBorderSecondary}`,
        opacity: invalid ? 0.7 : 1,
      }}
      onClick={clickable ? onJump : undefined}
    >
      <Flexbox horizontal align={'center'} gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {label}
        </Text>
        {invalid && (
          <Tag size={'small'} variant={'borderless'}>
            {t('pageEditor.review.impact.invalid')}
          </Tag>
        )}
        {clickable && (
          <Icon color={cssVar.colorTextQuaternary} icon={CornerDownRightIcon} size={12} />
        )}
      </Flexbox>
      <div
        style={{
          overflow: 'hidden',
          display: '-webkit-box',
          fontSize: 12,
          lineHeight: 1.6,
          color: invalid ? cssVar.colorTextTertiary : cssVar.colorTextSecondary,
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 3,
        }}
      >
        {anchor.quote}
      </div>
    </Block>
  );
});

ReviewQuote.displayName = 'ReviewQuote';

export default ReviewQuote;
