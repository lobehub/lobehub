import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { useState } from 'react';

import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';

import { DEFAULT_WIDTH, FOOTER_HEIGHT, ITEM_HEIGHT, MAX_PANEL_HEIGHT, TOOLBAR_HEIGHT } from '../const';
import { usePanelHandlers } from '../hooks/usePanelHandlers';
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
  const { handleClose } = usePanelHandlers({
    onModelChange: onModelChangeProp,
    onOpenChange,
  });

  const panelHeight =
    enabledList.length === 0
      ? TOOLBAR_HEIGHT + ITEM_HEIGHT['no-provider'] + FOOTER_HEIGHT
      : MAX_PANEL_HEIGHT;

  return (
    <Flexbox
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: panelHeight,
        position: 'relative',
        width: DEFAULT_WIDTH,
      }}
    >
      <Toolbar searchKeyword={searchKeyword} onSearchKeywordChange={setSearchKeyword} />
      <List
        groupMode={'byModel'}
        model={modelProp}
        provider={providerProp}
        searchKeyword={searchKeyword}
        onModelChange={onModelChangeProp}
        onOpenChange={onOpenChange}
      />
      <Footer onClose={handleClose} />
    </Flexbox>
  );
};
