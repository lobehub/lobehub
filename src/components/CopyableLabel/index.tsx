import { CopyButton, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type CSSProperties } from 'react';
import { memo } from 'react';

import { sx } from '@/styles/sx';

import { copyableRevealMarker } from './markers.stylex';

const styles = stylex.create({
  hoverCopy: {
    opacity: {
      'default': 0,
      // Touch screens cannot hover, so the button stays visible there
      '@media (hover: none)': 1,
      [stylex.when.ancestor(':hover', copyableRevealMarker)]: 1,
      [stylex.when.ancestor(':focus-within', copyableRevealMarker)]: 1,
    },
    transition: 'opacity 0.15s',
  },
});

interface CopyableLabelProps {
  className?: string;
  /**
   * Hide the copy button until the label, or an ancestor carrying
   * `copyableRevealMarker`, is hovered or focused.
   */
  revealCopyOnHover?: boolean;
  style?: CSSProperties;
  value?: string | null;
  wrap?: boolean;
}

const CopyableLabel = memo<CopyableLabelProps>(
  ({ className, revealCopyOnHover, style, value = '--', wrap }) => {
    const rootClassName = sx(revealCopyOnHover && copyableRevealMarker, className ?? '').className;
    const copyButton = (
      <CopyButton
        className={revealCopyOnHover ? stylex.props(styles.hoverCopy).className : undefined}
        content={value || '--'}
        size={'small'}
      />
    );

    if (wrap) {
      return (
        <Flexbox
          horizontal
          align={'flex-start'}
          className={rootClassName}
          gap={4}
          style={{
            position: 'relative',
            width: '100%',
            ...style,
          }}
        >
          <Text
            style={{
              color: 'inherit',
              flex: 1,
              fontFamily: 'inherit',
              fontSize: 'inherit',
              margin: 0,
              minWidth: 0,
              overflowWrap: 'anywhere',
              whiteSpace: 'pre-wrap',
            }}
          >
            {value || '--'}
          </Text>
          {copyButton}
        </Flexbox>
      );
    }

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={rootClassName}
        gap={4}
        style={{
          overflow: 'hidden',
          position: 'relative',
          ...style,
        }}
      >
        <Text
          ellipsis
          style={{
            color: 'inherit',
            fontFamily: 'inherit',
            fontSize: 'inherit',
            margin: 0,
            overflow: 'hidden',
            width: '100%',
          }}
        >
          {value || '--'}
        </Text>
        {copyButton}
      </Flexbox>
    );
  },
);

export default CopyableLabel;
