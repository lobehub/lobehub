'use client';

import { Button, type ButtonProps, Flexbox } from '@lobehub/ui';
import { DropdownMenu, type DropdownMenuProps } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import { createContext, type CSSProperties, type ReactNode, use, useMemo } from 'react';

interface SharedVisualProps {
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  size?: ButtonProps['size'];
  type?: ButtonProps['type'];
}

interface SplitButtonProps extends SharedVisualProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

const SplitButtonContext = createContext<SharedVisualProps>({});

const styles = createStaticStyles(({ css }) => ({
  splitButton: css`
    & > :where(button, a):first-of-type {
      border-start-end-radius: 0;
      border-end-end-radius: 0;
    }

    & > :where(button, a):last-of-type {
      margin-inline-start: -1px;
      border-start-start-radius: 0;
      border-end-start-radius: 0;
    }
  `,
}));

const SplitButton = ({
  children,
  className,
  style,
  danger,
  disabled,
  loading,
  size,
  type,
}: SplitButtonProps) => {
  const shared = useMemo<SharedVisualProps>(
    () => ({ danger, disabled, loading, size, type }),
    [danger, disabled, loading, size, type],
  );
  return (
    <SplitButtonContext value={shared}>
      <Flexbox horizontal className={cx(styles.splitButton, className)} style={style}>
        {children}
      </Flexbox>
    </SplitButtonContext>
  );
};

const SplitButtonMain = (props: ButtonProps) => {
  const shared = use(SplitButtonContext);
  return <Button {...shared} {...props} />;
};

interface SplitButtonMenuProps extends Omit<DropdownMenuProps, 'children'> {
  icon?: ReactNode;
}

const SplitButtonMenu = ({
  icon = <ChevronDownIcon size={14} />,
  ...menuProps
}: SplitButtonMenuProps) => {
  const shared = use(SplitButtonContext);
  return (
    <DropdownMenu {...menuProps}>
      <Button {...shared} icon={icon} />
    </DropdownMenu>
  );
};

type SplitButtonComponent = typeof SplitButton & {
  Main: typeof SplitButtonMain;
  Menu: typeof SplitButtonMenu;
};

(SplitButton as SplitButtonComponent).Main = SplitButtonMain;
(SplitButton as SplitButtonComponent).Menu = SplitButtonMenu;

export type { SplitButtonMenuProps, SplitButtonProps };
export default SplitButton as SplitButtonComponent;
