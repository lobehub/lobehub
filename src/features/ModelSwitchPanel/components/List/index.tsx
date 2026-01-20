import { Flexbox, TooltipGroup } from '@lobehub/ui';
import type { FC } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';

import {
  FOOTER_HEIGHT,
  INITIAL_RENDER_COUNT,
  ITEM_HEIGHT,
  MAX_PANEL_HEIGHT,
  TOOLBAR_HEIGHT,
} from '../../const';
import { useBuildVirtualItems } from '../../hooks/useBuildVirtualItems';
import { useDelayedRender } from '../../hooks/useDelayedRender';
import { useModelAndProvider } from '../../hooks/useModelAndProvider';
import { usePanelHandlers } from '../../hooks/usePanelHandlers';
import { styles } from '../../styles';
import type { GroupMode } from '../../types';
import { getVirtualItemKey, menuKey } from '../../utils';
import { VirtualItemRenderer } from './VirtualItemRenderer';

interface ListProps {
  groupMode: GroupMode;
  isOpen: boolean;
  model?: string;
  onModelChange?: (params: { model: string; provider: string }) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
  provider?: string;
  searchKeyword?: string;
}

export const List: FC<ListProps> = ({
  groupMode,
  isOpen,
  model: modelProp,
  onModelChange: onModelChangeProp,
  onOpenChange,
  provider: providerProp,
  searchKeyword = '',
}) => {
  const { t: tCommon } = useTranslation('common');
  const newLabel = tCommon('new');

  // Get enabled models list
  const enabledList = useEnabledChatModels();

  // Get delayed render state
  const renderAll = useDelayedRender(isOpen);

  // Get model and provider
  const { model, provider } = useModelAndProvider(modelProp, providerProp);

  // Get handlers
  const { handleModelChange, handleClose } = usePanelHandlers({
    onModelChange: onModelChangeProp,
    onOpenChange,
  });

  // Build virtual items
  const virtualItems = useBuildVirtualItems(enabledList, groupMode, searchKeyword);

  // Calculate panel height
  const panelHeight = useMemo(
    () =>
      enabledList.length === 0
        ? TOOLBAR_HEIGHT + ITEM_HEIGHT['no-provider'] + FOOTER_HEIGHT
        : MAX_PANEL_HEIGHT,
    [enabledList.length],
  );

  // Calculate active key
  const activeKey = menuKey(provider, model);

  return (
    <Flexbox
      className={styles.list}
      flex={1}
      style={{
        height: panelHeight - TOOLBAR_HEIGHT - FOOTER_HEIGHT,
        paddingBlock: groupMode === 'byModel' ? 8 : 0,
      }}
    >
      <TooltipGroup>
        {virtualItems
          .slice(0, renderAll ? virtualItems.length : INITIAL_RENDER_COUNT)
          .map((item) => (
            <VirtualItemRenderer
              activeKey={activeKey}
              item={item}
              key={getVirtualItemKey(item)}
              newLabel={newLabel}
              onClose={handleClose}
              onModelChange={handleModelChange}
            />
          ))}
      </TooltipGroup>
    </Flexbox>
  );
};
