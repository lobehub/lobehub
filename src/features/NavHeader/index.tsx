import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox, TooltipGroup } from '@lobehub/ui';
import { type CSSProperties, type ReactNode } from 'react';
import { memo } from 'react';

import ToggleLeftPanelButton from '@/features/NavPanel/ToggleLeftPanelButton';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export interface NavHeaderProps extends Omit<FlexboxProps, 'children'> {
  children?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  showTogglePanelButton?: boolean;
  styles?: {
    center?: CSSProperties;
    left?: CSSProperties;
    right?: CSSProperties;
  };
}

const NavHeader = memo<NavHeaderProps>(
  ({ showTogglePanelButton = true, style, children, left, right, styles, ...rest }) => {
    const expand = useGlobalStore(systemStatusSelectors.showLeftPanel);

    const noContent = !left && !right;

    if (noContent && expand) return;

    return (
      <Flexbox
        horizontal
        align={'center'}
        flex={'none'}
        gap={4}
        height={44}
        justify={'space-between'}
        padding={8}
        style={style}
        {...rest}
      >
        <TooltipGroup>
          <Flexbox horizontal align={'center'} gap={2} justify={'flex-start'} style={styles?.left}>
            {showTogglePanelButton && !expand && <ToggleLeftPanelButton />}
            {left}
          </Flexbox>
          {children && (
            <Flexbox flex={1} style={styles?.center}>
              {children}
            </Flexbox>
          )}
          <Flexbox horizontal align={'center'} gap={2} justify={'flex-end'} style={styles?.right}>
            {right}
          </Flexbox>
        </TooltipGroup>
      </Flexbox>
    );
  },
);

export default NavHeader;
