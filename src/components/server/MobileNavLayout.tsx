import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';

import { sx } from '@/styles/sx';

const DEFAULT_SCROLL_ID = 'lobe-mobile-scroll-container';

const styles = stylex.create({
  // Full-height mobile pages scroll their content pane without a visible bar.
  // This used to be AppTheme's descendant `#lobe-mobile-scroll-container` rule.
  hiddenScrollbar: {
    '::-webkit-scrollbar': { height: 0, width: 0 },
    'scrollbarWidth': 'none',
  },
});

interface MobileContentLayoutProps extends FlexboxProps {
  header?: ReactNode;
  withNav?: boolean;
}

const MobileContentLayout = ({
  children,
  withNav,
  style,
  header,
  className,
  id = DEFAULT_SCROLL_ID,
  ...rest
}: MobileContentLayoutProps) => {
  const content = (
    // Only the shared scroll container hides its bar; a caller that renames the
    // element opts out, exactly as the id-scoped CSS rule did.
    <Flexbox
      className={sx(id === DEFAULT_SCROLL_ID && styles.hiddenScrollbar, className).className}
      height="100%"
      id={id}
      width="100%"
      style={{
        overflowX: 'hidden',
        overflowY: 'auto',
        position: 'relative',
        ...style,
        // TabNav Height
        paddingBottom: withNav ? 48 : style?.paddingBottom,
      }}
      {...rest}
    >
      {children}
    </Flexbox>
  );

  if (!header) return content;

  return (
    <Flexbox height={'100%'} style={{ overflow: 'hidden', position: 'relative' }} width={'100%'}>
      {header}
      <Flexbox
        className={sx(styles.hiddenScrollbar, className).className}
        height="100%"
        id={DEFAULT_SCROLL_ID}
        width="100%"
        style={{
          overflowX: 'hidden',
          overflowY: 'auto',
          position: 'relative',
          ...style,
          // TabNav Height
          paddingBottom: withNav ? 48 : style?.paddingBottom,
        }}
        {...rest}
      >
        {children}
      </Flexbox>
    </Flexbox>
  );
};

export default MobileContentLayout;
