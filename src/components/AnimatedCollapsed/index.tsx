import { AnimatePresence, m as motion } from 'motion/react';
import { type CSSProperties, type ReactNode, memo } from 'react';

interface AnimatedCollapsedProps {
  children: ReactNode;
  height?: {
    collapsed?: string | number;
    open?: string | number;
  };
  open: boolean;
  style?: CSSProperties;
  styles?: {
    collapsed?: CSSProperties;
    open?: CSSProperties;
  };
  width?: {
    collapsed?: string | number;
    open?: string | number;
  };
}

const AnimatedCollapsed = memo<AnimatedCollapsedProps>(
  ({ open, children, styles, style, width, height }) => {
    return (
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            animate="open"
            exit="collapsed"
            initial="collapsed"
            style={style}
            transition={{
              duration: 0.2,
              ease: [0.4, 0, 0.2, 1], // Use ease-out easing function
            }}
            variants={{
              collapsed: {
                ...(styles?.collapsed as any),
                height: height?.collapsed ?? 0,
                opacity: 0,
                width: width?.collapsed ?? 0,
              },
              open: {
                ...(styles?.open as any),
                height: height?.open ?? 'auto',
                opacity: 1,
                width: width?.open ?? 'auto',
              },
            }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    );
  },
);

export default AnimatedCollapsed;
