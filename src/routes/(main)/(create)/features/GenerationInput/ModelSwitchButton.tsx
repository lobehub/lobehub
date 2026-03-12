'use client';

import { ModelIcon } from '@lobehub/icons';
import {
  Center,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  stopPropagation,
} from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';

import { styles as modelSwitchPanelStyles } from '@/features/ModelSwitchPanel/styles';

import { ModelSwitchButtonContext } from './ModelSwitchButtonContext';

const styles = createStaticStyles(({ css, cssVar }) => ({
  icon: cx(
    'model-switch',
    css`
      transition: scale 400ms cubic-bezier(0.215, 0.61, 0.355, 1);
    `,
  ),
  model: css`
    cursor: pointer;
    border-radius: 24px;

    :hover {
      background: ${cssVar.colorFillSecondary};
    }

    :active {
      .model-switch {
        scale: 0.8;
      }
    }
  `,
  content: css`
    min-width: 280px;
    padding: 8px;
  `,
}));

interface ModelSwitchButtonProps {
  content: ReactNode;
  model?: string;
  title?: ReactNode;
}

const MAX_LIST_HEIGHT = 360;

const ModelSwitchButton = memo<ModelSwitchButtonProps>(({ model = '', content }) => {
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
  }, []);

  const contextValue = useMemo(() => ({ onClose: () => setOpen(false) }), []);

  return (
    <DropdownMenuRoot open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger openOnHover={false}>
        <Center className={styles.model} height={36} width={36}>
          <div className={styles.icon}>
            <ModelIcon model={model} size={22} />
          </div>
        </Center>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner placement="topLeft">
          <DropdownMenuPopup
            className={cx(modelSwitchPanelStyles.container, styles.content)}
            onKeyDown={stopPropagation}
          >
            <ModelSwitchButtonContext value={contextValue}>
              <div style={{ maxHeight: MAX_LIST_HEIGHT, overflow: 'auto' }}>{content}</div>
            </ModelSwitchButtonContext>
          </DropdownMenuPopup>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  );
});

ModelSwitchButton.displayName = 'ModelSwitchButton';

export default ModelSwitchButton;
