'use client';

import type { DocumentCommentSelectionAnchor } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Tag, Text } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from '../styles';

interface AnchorQuoteProps {
  anchor: DocumentCommentSelectionAnchor;
  className?: string;
  /** Show a dismiss control — the composer's pending quote can be dropped before publishing. */
  onDismiss?: () => void;
  /** Jump to the quoted run in the body. Omitted when the run is gone. */
  onLocate?: () => void;
  /** The quoted run no longer exists in the body. */
  orphaned?: boolean;
}

/**
 * The quoted run a comment is attached to.
 *
 * It renders from the stored quote, never from the body, so a comment stays
 * readable after its run is edited away — the same retention promise the
 * Topic comment anchor preview makes.
 *
 * One line, truncated: the quote is context for the comment underneath, not
 * content in its own right, so it must not out-weigh the comment it belongs
 * to. The full text is a tooltip away whenever it doesn't fit.
 */
const AnchorQuote = memo<AnchorQuoteProps>(
  ({ anchor, className, onDismiss, onLocate, orphaned }) => {
    const { t } = useTranslation('file');
    const clickable = Boolean(onLocate) && !orphaned;
    // Only a jump target that has gone missing is "disabled"; a plain quote row
    // (the composer's, which still holds an operable Remove control) is not.
    const disabled = Boolean(onLocate) && orphaned;

    return (
      <Flexbox
        horizontal
        align={'center'}
        aria-disabled={disabled ? true : undefined}
        gap={6}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        className={cx(
          styles.anchorQuote,
          clickable && styles.anchorQuoteClickable,
          orphaned && styles.anchorQuoteOrphaned,
          className,
        )}
        onClick={clickable ? onLocate : undefined}
        onKeyDown={(event) => {
          if (!clickable || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          onLocate?.();
        }}
      >
        <Text className={styles.anchorQuoteLabel} fontSize={12}>
          {t('pageEditor.comments.anchor.label')}
        </Text>
        <Text
          className={styles.anchorQuoteText}
          ellipsis={{ tooltipWhenOverflow: true }}
          fontSize={12}
        >
          {anchor.quote}
        </Text>
        {orphaned && <Tag size={'small'}>{t('pageEditor.comments.anchor.missing')}</Tag>}
        {onDismiss && (
          <ActionIcon
            aria-label={t('pageEditor.comments.anchor.remove')}
            icon={X}
            size={'small'}
            title={t('pageEditor.comments.anchor.remove')}
            onClick={(event) => {
              event.stopPropagation();
              onDismiss();
            }}
          />
        )}
      </Flexbox>
    );
  },
);

AnchorQuote.displayName = 'DocumentCommentAnchorQuote';

export default AnchorQuote;
