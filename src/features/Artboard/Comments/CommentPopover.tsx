import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

import { sx } from '@/styles/sx';

import { popoverBox } from './layout';

const styles = stylex.create({
  popover: {
    backgroundColor: cssVar.colorBgElevated,
    borderRadius: 14,
    boxShadow: cssVar.boxShadowSecondary,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    position: 'absolute',
    userSelect: 'text',
    zIndex: 8,
  },
});

interface CommentPopoverProps {
  anchor: { x: number; y: number };
  children: ReactNode;
  size: { height: number; width: number };
}

const CommentPopover = ({ anchor, children, size }: CommentPopoverProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(420);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setMeasured(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} {...sx(styles.popover, popoverBox(anchor, size, measured))}>
      {children}
    </div>
  );
};

export default CommentPopover;
