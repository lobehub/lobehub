import { Flexbox, TooltipGroup } from '@lobehub/ui';
import { type FC } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';

import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';

import { FOOTER_HEIGHT, ITEM_HEIGHT, MAX_PANEL_HEIGHT, TOOLBAR_HEIGHT } from '../../const';
import { useBuildListItems } from '../../hooks/useBuildListItems';
import { useModelAndProvider } from '../../hooks/useModelAndProvider';
import { usePanelHandlers } from '../../hooks/usePanelHandlers';
import { styles } from '../../styles';
import { type GroupMode } from '../../types';
import { menuKey } from '../../utils';
import { ListItemRenderer } from './ListItemRenderer';

interface ListProps {
  groupMode: GroupMode;
  model?: string;
  onModelChange?: (params: { model: string; provider: string }) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
  provider?: string;
  searchKeyword?: string;
}

export const List: FC<ListProps> = ({
  groupMode,
  model: modelProp,
  onModelChange: onModelChangeProp,
  onOpenChange,
  provider: providerProp,
  searchKeyword = '',
}) => {
  const { t: tCommon } = useTranslation('common');
  const newLabel = tCommon('new');

  const [isScrolling, setIsScrolling] = useState(false);
  const enabledList = useEnabledChatModels();
  const { model, provider } = useModelAndProvider(modelProp, providerProp);
  const { handleModelChange, handleClose } = usePanelHandlers({
    onModelChange: onModelChangeProp,
    onOpenChange,
  });
  const listItems = useBuildListItems(enabledList, groupMode, searchKeyword);

  const panelHeight = useMemo(
    () =>
      enabledList.length === 0
        ? TOOLBAR_HEIGHT + ITEM_HEIGHT['no-provider'] + FOOTER_HEIGHT
        : MAX_PANEL_HEIGHT,
    [enabledList.length],
  );

  const activeKey = menuKey(provider, model);

  const handleScrollingStateChange = useCallback((scrolling: boolean) => {
    setIsScrolling(scrolling);
  }, []);

  const itemContent = useCallback(
    (index: number) => {
      const item = listItems[index];
      return (
        <ListItemRenderer
          activeKey={activeKey}
          isScrolling={isScrolling}
          item={item}
          newLabel={newLabel}
          onClose={handleClose}
          onModelChange={handleModelChange}
        />
      );
    },
    [activeKey, handleClose, handleModelChange, isScrolling, listItems, newLabel],
  );

  const listHeight = panelHeight - TOOLBAR_HEIGHT - FOOTER_HEIGHT;

  return (
    <Flexbox
      className={styles.list}
      flex={1}
      style={{
        height: listHeight,
      }}
    >
      <TooltipGroup>
        <Virtuoso
          isScrolling={handleScrollingStateChange}
          itemContent={itemContent}
          overscan={200}
          style={{ height: listHeight }}
          totalCount={listItems.length}
        />
      </TooltipGroup>
    </Flexbox>
  );
};
