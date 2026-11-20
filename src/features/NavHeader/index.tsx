import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox, TooltipGroup } from '@lobehub/ui';
import { type CSSProperties, type ReactNode } from 'react';
import { memo } from 'react';

import ToggleLeftPanelButton, { isMacDesktop } from '@/features/NavPanel/ToggleLeftPanelButton';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { DENSITY_TOKENS, useDensityTokens } from '@/styles/density';
import { isMobileSurface } from '@/utils/mobileSurface';

import { getNavHeaderLeading } from './leading';
import MobileHeaderNav from './MobileHeaderNav';
import MobileRouteTitle from './MobileRouteTitle';

export interface NavHeaderProps extends Omit<FlexboxProps, 'children'> {
  children?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  showTogglePanelButton?: boolean;
  slotClassNames?: {
    center?: string;
    left?: string;
    right?: string;
  };
  styles?: {
    center?: CSSProperties;
    left?: CSSProperties;
    right?: CSSProperties;
  };
}

const NavHeader = memo<NavHeaderProps>(
  ({
    showTogglePanelButton = true,
    style,
    children,
    left,
    right,
    slotClassNames,
    styles,
    ...rest
  }) => {
    const expand = useGlobalStore(systemStatusSelectors.showLeftPanel);
    const density = useDensityTokens();
    const mobile = isMobileSurface();
    const headerHeight = mobile ? DENSITY_TOKENS.loose.headerHeight : density.headerHeight;

    const leading = getNavHeaderLeading({
      expand: !!expand,
      isMacDesktop,
      mobile,
      noContent: !left && !right && !children,
      showTogglePanelButton,
    });

    if (leading === 'hidden') return;

    return (
      <Flexbox
        allowShrink
        horizontal
        align={'center'}
        flex={'none'}
        gap={4}
        height={headerHeight}
        justify={'space-between'}
        paddingBlock={(headerHeight - 28) / 2}
        paddingInline={8}
        style={style}
        {...rest}
      >
        <TooltipGroup>
          <Flexbox
            allowShrink
            horizontal
            align={'center'}
            className={slotClassNames?.left}
            gap={2}
            justify={'flex-start'}
            style={styles?.left}
          >
            {leading === 'mobile' && <MobileHeaderNav />}
            {leading === 'toggle' && <ToggleLeftPanelButton />}
            {/* `left={null}` opts a mobile header out of the route-title fallback. */}
            {left === undefined && leading === 'mobile' && !children ? <MobileRouteTitle /> : left}
          </Flexbox>
          {children && (
            <Flexbox className={slotClassNames?.center} flex={1} style={styles?.center}>
              {children}
            </Flexbox>
          )}
          <Flexbox
            horizontal
            align={'center'}
            className={slotClassNames?.right}
            gap={2}
            justify={'flex-end'}
            style={styles?.right}
          >
            {right}
          </Flexbox>
        </TooltipGroup>
      </Flexbox>
    );
  },
);

export default NavHeader;
