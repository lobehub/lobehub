import { type FlexboxProps } from '@lobehub/ui';
import { Button, Flexbox, ScrollShadow } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

const styles = stylex.create({
  button: {
    position: 'absolute',
    zIndex: 10,
    insetBlockStart: '50%',
    transform: 'translateY(-50%)',
    color: cssVar.colorTextSecondary,
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 },
    transition: `opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut}`,
    borderColor: { 'default': null, ':hover': cssVar.colorBorder },
    boxShadow: { 'default': null, ':hover': cssVar.boxShadowTertiary },
  },
  container: {
    position: 'relative',
  },
  leftButton: {
    insetInlineStart: '16px',
  },
  rightButton: {
    insetInlineEnd: '16px',
  },
});

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
    <Flexbox
      horizontal
      className={stylex.props(styles.container, stylex.defaultMarker()).className}
      width={'100%'}
      {...rest}
    >
      {canScrollLeft && (
        <Button
          className={stylex.props(styles.button, styles.leftButton).className}
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
        {children}
      </ScrollShadow>
      {canScrollRight && (
        <Button
          className={stylex.props(styles.button, styles.rightButton).className}
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
