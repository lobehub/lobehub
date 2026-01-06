import { TooltipGroup } from '@lobehub/ui';
import { Popover } from 'antd';
import { memo, useCallback, useState } from 'react';

import { PanelContent } from './components/PanelContent';
import { styles } from './styles';
import type { ModelSwitchPanelProps } from './types';

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

    // Use controlled open if provided, otherwise use internal state
    const isOpen = open ?? internalOpen;

    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        setInternalOpen(nextOpen);
        onOpenChange?.(nextOpen);
      },
      [onOpenChange],
    );

    return (
      <TooltipGroup>
        <Popover
          arrow={false}
          classNames={{
            container: styles.container,
          }}
          content={
            <PanelContent
              isOpen={isOpen}
              model={modelProp}
              onModelChange={onModelChange}
              onOpenChange={handleOpenChange}
              provider={providerProp}
            />
          }
          onOpenChange={handleOpenChange}
          open={isOpen}
          placement={placement}
        >
          {children}
        </Popover>
      </TooltipGroup>
    );
  },
);

ModelSwitchPanel.displayName = 'ModelSwitchPanel';

export default ModelSwitchPanel;

export { type ModelSwitchPanelProps } from './types';
