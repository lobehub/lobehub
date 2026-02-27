import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

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

  // Set initial scroll position to keep active model centered
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeNodeRef = useRef<HTMLDivElement | null>(null);
  const hasInitializedPositionRef = useRef(false);

  const activeItemRef = useCallback((node: HTMLDivElement | null) => {
    activeNodeRef.current = node;
  }, []);

  const listHeight = panelHeight - TOOLBAR_HEIGHT - FOOTER_HEIGHT;

  useLayoutEffect(() => {
    if (hasInitializedPositionRef.current) return;

    const container = listRef.current;
    const activeNode = activeNodeRef.current;
    if (!container || !activeNode) return;

    const targetScrollTop =
      activeNode.offsetTop - (container.clientHeight - activeNode.offsetHeight) / 2;
    container.scrollTop = Math.max(0, targetScrollTop);
    hasInitializedPositionRef.current = true;
  }, [listHeight, activeKey]);

  return (
    <Flexbox className={styles.list} flex={1} ref={listRef} style={{ height: listHeight }}>
      {listItems.map((item, index) => {
        const itemKey = menuKey(
          'provider' in item && item.provider ? item.provider.id : '',
          'model' in item && item.model
            ? item.model.id
            : 'data' in item && item.data
              ? item.data.displayName
              : `${item.type}-${index}`,
        );
        const isActive =
          (item.type === 'provider-model-item' &&
            menuKey(item.provider.id, item.model.id) === activeKey) ||
          (item.type === 'model-item-single' &&
            menuKey(item.data.providers[0].id, item.data.model.id) === activeKey) ||
          (item.type === 'model-item-multiple' &&
            item.data.providers.some((p) => menuKey(p.id, item.data.model.id) === activeKey));

        const renderItem = (key?: string) => (
          <ListItemRenderer
            activeKey={activeKey}
            item={item}
            key={key}
            newLabel={newLabel}
            onClose={handleClose}
            onModelChange={handleModelChange}
          />
        );

        return isActive ? (
          <div key={itemKey} ref={activeItemRef}>
            {renderItem()}
          </div>
        ) : (
          renderItem(itemKey)
        );
      })}
    </Flexbox>
  );
};
