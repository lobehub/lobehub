import { Flexbox, type FlexboxProps, TooltipGroup } from '@lobehub/ui';
import { type CSSProperties, type ReactNode, memo } from 'react';

import ToggleLeftPanelButton from '@/features/NavPanel/ToggleLeftPanelButton';
import { useNavPanel } from '@/features/NavPanel/hooks/useNavPanel';

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
    const { expand } = useNavPanel();
    const noContent = !left && !right;

    if (noContent && expand) return;

    return (
      <Flexbox
        align={'center'}
        flex={'none'}
        gap={4}
        height={44}
        horizontal
        justify={'space-between'}
        padding={8}
        style={style}
        {...rest}
      >
        <TooltipGroup>
          <Flexbox align={'center'} gap={2} horizontal justify={'flex-start'} style={styles?.left}>
            {showTogglePanelButton && !expand && <ToggleLeftPanelButton />}
            {left}
          </Flexbox>
          {children && (
            <Flexbox flex={1} style={styles?.center}>
              {children}
            </Flexbox>
          )}
          <Flexbox align={'center'} gap={2} horizontal justify={'flex-end'} style={styles?.right}>
            {right}
          </Flexbox>
        </TooltipGroup>
      </Flexbox>
    );
  },
);

export default NavHeader;
