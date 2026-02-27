import { type FC } from 'react';
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
  model?: string;
  onModelChange?: (params: { model: string; provider: string }) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
  provider?: string;
}

export const PanelContent: FC<PanelContentProps> = ({
  model: modelProp,
  onModelChange: onModelChangeProp,
  onOpenChange,
  provider: providerProp,
}) => {
  const enabledList = useEnabledChatModels();
  const [searchKeyword, setSearchKeyword] = useState('');
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
      position={{ x: 0, y: 0 }}
      size={{ height: panelHeight, width: panelWidth }}
      style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}
      onResizeStop={(_e, _direction, ref) => {
        handlePanelWidthChange(ref.offsetWidth);
      }}
    >
      <Toolbar
        groupMode={groupMode}
        searchKeyword={searchKeyword}
        onGroupModeChange={handleGroupModeChange}
        onSearchKeywordChange={setSearchKeyword}
      />
      <List
        groupMode={groupMode}
        model={modelProp}
        provider={providerProp}
        searchKeyword={searchKeyword}
        onModelChange={onModelChangeProp}
        onOpenChange={onOpenChange}
      />
      <Footer onClose={handleClose} />
    </Rnd>
  );
};
