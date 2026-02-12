import { type FlexboxProps } from '@lobehub/ui';
import { Button, Flexbox, ScrollShadow } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  button: css`
    position: absolute;
    z-index: 10;
    inset-block-start: 50%;
    transform: translateY(-50%);

    color: ${cssVar.colorTextSecondary};

    opacity: 0;

    transition: opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};

    &:hover {
      border-color: ${cssVar.colorBorder} !important;
      box-shadow: ${cssVar.boxShadowTertiary} !important;
    }
  `,
  container: css`
    position: relative;

    &:hover .scroll-button {
      opacity: 1;
    }
  `,
  leftButton: css`
    inset-inline-start: 0;
  `,
  rightButton: css`
    inset-inline-end: 0;
  `,
}));

const ScrollShadowWithButton = memo<FlexboxProps>(({ children, ...rest }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScrollability = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  const handleScroll = useCallback(
    (direction: 'left' | 'right') => {
      const container = scrollRef.current;
      if (!container) return;

      const scrollAmount = container.clientWidth / 1.5;
      const targetScroll =
        direction === 'left'
          ? container.scrollLeft - scrollAmount
          : container.scrollLeft + scrollAmount;

      container.scrollTo({
        behavior: 'smooth',
        left: targetScroll,
      });

      setTimeout(checkScrollability, 300);
    },
    [checkScrollability],
  );

  useEffect(() => {
    checkScrollability();
  }, []);

  return (
    <Flexbox horizontal className={styles.container} width={'100%'} {...rest}>
      {canScrollLeft && (
        <Button
          className={cx(styles.button, styles.leftButton, 'scroll-button')}
          icon={ChevronLeft}
          shape={'circle'}
          type={'default'}
          onClick={() => handleScroll('left')}
        />
      )}
      <ScrollShadow
        hideScrollBar
        offset={16}
        orientation={'horizontal'}
        ref={scrollRef}
        size={16}
        onScroll={checkScrollability}
        onScrollCapture={checkScrollability}
      >
        <Flexbox horizontal gap={12}>
          {children}
        </Flexbox>
      </ScrollShadow>
      {canScrollRight && (
        <Button
          className={cx(styles.button, styles.rightButton, 'scroll-button')}
          icon={ChevronRight}
          shape={'circle'}
          type={'default'}
          onClick={() => handleScroll('right')}
        />
      )}
    </Flexbox>
  );
});

export default ScrollShadowWithButton;
