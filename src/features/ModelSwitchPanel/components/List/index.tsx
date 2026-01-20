import { Flexbox, TooltipGroup } from '@lobehub/ui';
import type { FC } from 'react';
import { useLayoutEffect, useMemo, useRef } from 'react';
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
import type { GroupMode, VirtualItem } from '../../types';
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
  const listRef = useRef<HTMLDivElement>(null);
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

  const activeIndex = useMemo(() => {
    if (!activeKey) return -1;
    return virtualItems.findIndex((item) => {
      switch (item.type) {
        case 'provider-model-item': {
          return menuKey(item.provider.id, item.model.id) === activeKey;
        }
        case 'model-item-single': {
          return menuKey(item.data.providers[0].id, item.data.model.id) === activeKey;
        }
        case 'model-item-multiple': {
          return item.data.providers.some((p) => menuKey(p.id, item.data.model.id) === activeKey);
        }
        default: {
          return false;
        }
      }
    });
  }, [activeKey, virtualItems]);

  useLayoutEffect(() => {
    if (!isOpen || !activeKey) return;
    const container = listRef.current;
    if (!container) return;
    const selector = `[data-model-key="${CSS.escape(activeKey)}"]`;
    const target = container.querySelector<HTMLElement>(selector);
    if (!target) return;

    const offset =
      target.offsetTop - Math.max(0, (container.clientHeight - target.clientHeight) / 2);
    container.scrollTop = Math.max(0, offset);
  }, [activeKey, groupMode, isOpen, renderAll, searchKeyword]);

  const viewItemCount = useMemo(() => {
    const listHeight = panelHeight - TOOLBAR_HEIGHT - FOOTER_HEIGHT;
    return Math.ceil(listHeight / ITEM_HEIGHT['model-item']);
  }, [panelHeight]);

  const getItemHeight = useMemo(
    () => (item: VirtualItem) => {
      switch (item.type) {
        case 'group-header': {
          return ITEM_HEIGHT['group-header'];
        }
        case 'empty-model': {
          return ITEM_HEIGHT['empty-model'];
        }
        case 'no-provider': {
          return ITEM_HEIGHT['no-provider'];
        }
        default: {
          return ITEM_HEIGHT['model-item'];
        }
      }
    },
    [],
  );

  const itemHeights = useMemo(() => virtualItems.map(getItemHeight), [getItemHeight, virtualItems]);

  const prefixHeights = useMemo(() => {
    const heights = [0];
    for (const height of itemHeights) {
      const last = heights.at(-1) ?? 0;
      heights.push(last + height);
    }
    return heights;
  }, [itemHeights]);

  const renderWindow = useMemo(() => {
    const total = virtualItems.length;
    if (renderAll || total === 0) {
      return { end: total, paddingBottom: 0, paddingTop: 0, start: 0 };
    }

    const minWindow = Math.max(INITIAL_RENDER_COUNT, viewItemCount);
    const windowSize = Math.min(total, Math.max(minWindow, viewItemCount * 2 + 1));

    if (activeIndex < 0) {
      const end = Math.min(total, windowSize);
      return {
        end,
        paddingBottom: prefixHeights[total] - prefixHeights[end],
        paddingTop: 0,
        start: 0,
      };
    }

    let start = Math.max(0, activeIndex - Math.floor(windowSize / 2));
    let end = Math.min(total, start + windowSize);
    if (end - start < windowSize) {
      start = Math.max(0, end - windowSize);
    }

    return {
      end,
      paddingBottom: prefixHeights[total] - prefixHeights[end],
      paddingTop: prefixHeights[start],
      start,
    };
  }, [activeIndex, prefixHeights, renderAll, viewItemCount, virtualItems.length]);

  return (
    <Flexbox
      className={styles.list}
      flex={1}
      ref={listRef}
      style={{
        height: panelHeight - TOOLBAR_HEIGHT - FOOTER_HEIGHT,
        paddingBlock: groupMode === 'byModel' ? 8 : 0,
      }}
    >
      <TooltipGroup>
        <div
          style={{
            paddingBottom: renderWindow.paddingBottom,
            paddingTop: renderWindow.paddingTop,
          }}
        >
          {virtualItems.slice(renderWindow.start, renderWindow.end).map((item) => (
            <VirtualItemRenderer
              activeKey={activeKey}
              item={item}
              key={getVirtualItemKey(item)}
              newLabel={newLabel}
              onClose={handleClose}
              onModelChange={handleModelChange}
            />
          ))}
        </div>
      </TooltipGroup>
    </Flexbox>
  );
};
