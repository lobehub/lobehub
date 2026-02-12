import {
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';

import { PanelContent } from './components/PanelContent';
import { styles } from './styles';
import { type ModelSwitchPanelProps } from './types';

const ModelSwitchPanel = memo<ModelSwitchPanelProps>(
  ({
    children,
    model: modelProp,
    onModelChange,
    onOpenChange,
    open,
    placement = 'topLeft',
    provider: providerProp,
  }) => {
    const [internalOpen, setInternalOpen] = useState(false);
    const isOpen = open ?? internalOpen;

    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        setInternalOpen(nextOpen);
        onOpenChange?.(nextOpen);
      },
      [onOpenChange],
    );

    return (
      <DropdownMenuRoot open={isOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger openOnHover>{children}</DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner hoverTrigger placement={placement}>
            <DropdownMenuPopup className={styles.container}>
              <PanelContent
                model={modelProp}
                provider={providerProp}
                onModelChange={onModelChange}
                onOpenChange={handleOpenChange}
              />
            </DropdownMenuPopup>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    );
  },
);

ModelSwitchPanel.displayName = 'ModelSwitchPanel';

export default ModelSwitchPanel;

export { type ModelSwitchPanelProps } from './types';
