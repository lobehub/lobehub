import { Flexbox } from '@lobehub/ui';
import { type ComponentType, type FC, type ReactNode } from 'react';
import { useState } from 'react';
import { Rnd } from 'react-rnd';

import { useBusinessModelPricingPrefetch } from '@/business/client/hooks/useBusinessModelPricing';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors/general';
import type { EnabledProviderWithModels } from '@/types/aiProvider';

import { DEFAULT_WIDTH, ENABLE_RESIZING, MAX_WIDTH } from '../const';
import { usePanelSize } from '../hooks/usePanelSize';
import { usePanelState } from '../hooks/usePanelState';
import { usePanelWidthConstraints } from '../hooks/usePanelWidthConstraints';
import { List } from './List';
import type { PricingMode } from './ModelDetailPanel';
import { Toolbar } from './Toolbar';

interface PanelContentProps {
  /** Muted text shown after the active model's name, e.g. its reasoning effort */
  activeSecondaryText?: string;
  enabledList?: EnabledProviderWithModels[];
  model?: string;
  ModelItemComponent?: ComponentType<any>;
  notice?: ReactNode;
  onModelChange?: (params: { model: string; provider: string }) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
  pricingMode?: PricingMode;
  provider?: string;
}

export const PanelContent: FC<PanelContentProps> = ({
  ModelItemComponent,
  activeSecondaryText,
  enabledList: enabledListProp,
  model: modelProp,
  notice,
  onModelChange: onModelChangeProp,
  onOpenChange,
  pricingMode,
  provider: providerProp,
}) => {
  const chatEnabledList = useEnabledChatModels();
  const enabledList = enabledListProp ?? chatEnabledList;
  const [searchKeyword, setSearchKeyword] = useState('');
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  const { groupMode, handleGroupModeChange } = usePanelState();
  const { panelHeight, panelWidth, handlePanelWidthChange } = usePanelSize(enabledList.length);
  const {
    constrainedWidth,
    maxWidth: constrainedMaxWidth,
    minWidth: constrainedMinWidth,
    probeRef,
  } = usePanelWidthConstraints(panelWidth);

  useBusinessModelPricingPrefetch();

  const content = (
    <>
      {notice && (
        <Flexbox padding={8} style={{ flexShrink: 0 }}>
          {notice}
        </Flexbox>
      )}
      <Toolbar
        showGroupModeSwitch
        groupMode={groupMode}
        searchKeyword={searchKeyword}
        onGroupModeChange={handleGroupModeChange}
        onSearchKeywordChange={setSearchKeyword}
      />
      <List
        ModelItemComponent={ModelItemComponent}
        activeSecondaryText={activeSecondaryText}
        enabledList={enabledList}
        groupMode={groupMode}
        model={modelProp}
        pricingMode={pricingMode}
        provider={providerProp}
        searchKeyword={searchKeyword}
        onModelChange={onModelChangeProp}
        onOpenChange={onOpenChange}
      />
    </>
  );

  if (isDevMode) {
    return (
      <>
        <div
          aria-hidden
          ref={probeRef}
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            visibility: 'hidden',
            width: `min(${MAX_WIDTH}px, var(--available-width, ${MAX_WIDTH}px))`,
          }}
        />
        <Rnd
          disableDragging
          enableResizing={ENABLE_RESIZING}
          // Rnd needs a numeric `size.height`, but a fixed height overflows the top
          // edge when the upward-opening popup meets a short viewport. Pass the
          // clamp through Rnd's own `maxHeight` (a `style.maxHeight` gets overridden
          // by Rnd's internal default) so CSS caps the box to the space base-ui
          // exposes via `--available-height`; the inner list then flex-shrinks and
          // scrolls. Height resize is disabled, so this doesn't fight drag logic.
          maxHeight={`min(${panelHeight}px, var(--available-height, ${panelHeight}px))`}
          // re-resizable cannot parse CSS min() while dragging. Measure Base UI's
          // collision-aware width with the hidden probe and pass numeric bounds so
          // resize remains usable when a foldable or split window narrows the popup.
          maxWidth={constrainedMaxWidth}
          minWidth={constrainedMinWidth}
          position={{ x: 0, y: 0 }}
          size={{ height: panelHeight, width: constrainedWidth }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            position: 'relative',
          }}
          onResizeStop={(_e, _direction, ref) => {
            handlePanelWidthChange(ref.offsetWidth);
          }}
        >
          {content}
        </Rnd>
      </>
    );
  }

  return (
    <Flexbox
      style={{
        display: 'flex',
        flexDirection: 'column',
        // Clamp the panel to the viewport space base-ui exposes via
        // `--available-height` (falling back to the natural height before it's
        // measured). The trigger usually sits at the page bottom and the popup
        // opens upward; a fixed height would overflow the top edge and clip the
        // search box + first items on short viewports. Keeping a *concrete*
        // height (not max-height) lets the inner list flex-shrink and scroll.
        height: `min(${panelHeight}px, var(--available-height, ${panelHeight}px))`,
        position: 'relative',
        width: `min(${DEFAULT_WIDTH}px, var(--available-width, ${DEFAULT_WIDTH}px))`,
      }}
    >
      {content}
    </Flexbox>
  );
};
