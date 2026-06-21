import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { type ReactNode } from 'react';

interface MobileContentLayoutProps extends FlexboxProps {
  header?: ReactNode;
  withNav?: boolean;
}

const MOBILE_NAV_SAFE_PADDING = 'calc(48px + env(safe-area-inset-bottom, 0px))';

const MobileContentLayout = ({
  children,
  withNav,
  style,
  header,
  id = 'lobe-mobile-scroll-container',
  ...rest
}: MobileContentLayoutProps) => {
  const content = (
    <Flexbox
      height="100%"
      id={id}
      width="100%"
      style={{
        overflowX: 'hidden',
        overflowY: 'auto',
        position: 'relative',
        ...style,
        // TabNav Height
        paddingBottom: withNav ? MOBILE_NAV_SAFE_PADDING : style?.paddingBottom,
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
        height="100%"
        id={'lobe-mobile-scroll-container'}
        width="100%"
        style={{
          overflowX: 'hidden',
          overflowY: 'auto',
          position: 'relative',
          ...style,
          // TabNav Height
          paddingBottom: withNav ? MOBILE_NAV_SAFE_PADDING : style?.paddingBottom,
        }}
        {...rest}
      >
        {children}
      </Flexbox>
    </Flexbox>
  );
};

export default MobileContentLayout;
