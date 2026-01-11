import type { FC } from 'react';
import { useState } from 'react';
import { Rnd } from 'react-rnd';

import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';

import { ENABLE_RESIZING, MAX_WIDTH, MIN_WIDTH } from '../const';
import { usePanelHandlers } from '../hooks/usePanelHandlers';
import { usePanelSize } from '../hooks/usePanelSize';
import { usePanelState } from '../hooks/usePanelState';
import { Footer } from './Footer';
import { List } from './List';
import { Toolbar } from './Toolbar';

interface PanelContentProps {
  isOpen: boolean;
  model?: string;
  onModelChange?: (params: { model: string; provider: string }) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
  provider?: string;
}

export const PanelContent: FC<PanelContentProps> = ({
  isOpen,
  model: modelProp,
  onModelChange: onModelChangeProp,
  onOpenChange,
  provider: providerProp,
}) => {
  // Get enabled models list
  const enabledList = useEnabledChatModels();

  // Search keyword state
  const [searchKeyword, setSearchKeyword] = useState('');

  // Hooks for state management
  const { groupMode, handleGroupModeChange } = usePanelState();
  const { panelHeight, panelWidth, handlePanelWidthChange } = usePanelSize(enabledList.length);
  const { handleClose } = usePanelHandlers({
    onModelChange: onModelChangeProp,
    onOpenChange,
  });

  return (
    <Rnd
      disableDragging
      enableResizing={ENABLE_RESIZING}
      maxWidth={MAX_WIDTH}
      minWidth={MIN_WIDTH}
      onResizeStop={(_e, _direction, ref) => {
        handlePanelWidthChange(ref.offsetWidth);
      }}
      position={{ x: 0, y: 0 }}
      size={{ height: panelHeight, width: panelWidth }}
      style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}
    >
      <Toolbar
        groupMode={groupMode}
        onGroupModeChange={handleGroupModeChange}
        onSearchKeywordChange={setSearchKeyword}
        searchKeyword={searchKeyword}
      />
      <List
        groupMode={groupMode}
        isOpen={isOpen}
        model={modelProp}
        onModelChange={onModelChangeProp}
        onOpenChange={onOpenChange}
        provider={providerProp}
        searchKeyword={searchKeyword}
      />
      <Footer onClose={handleClose} />
    </Rnd>
  );
};

PanelContent.displayName = 'PanelContent';
