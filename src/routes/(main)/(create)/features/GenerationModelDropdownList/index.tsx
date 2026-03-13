'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { LucideArrowRight } from 'lucide-react';
import type { ComponentType } from 'react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Toolbar } from '@/features/ModelSwitchPanel/components/Toolbar';
import { useBuildListItems } from '@/features/ModelSwitchPanel/hooks/useBuildListItems';
import { usePanelState } from '@/features/ModelSwitchPanel/hooks/usePanelState';
import { styles as modelSwitchPanelStyles } from '@/features/ModelSwitchPanel/styles';
import type { ListItem } from '@/features/ModelSwitchPanel/types';
import { getListItemKey, menuKey } from '@/features/ModelSwitchPanel/utils';
import { useModelSwitchButtonContext } from '@/routes/(main)/(create)/features/GenerationInput/ModelSwitchButtonContext';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors/general';
import type { EnabledProviderWithModels } from '@/types/index';

import ListItemRenderer from './ListItemRenderer';

export interface GenerationModelDropdownListConfigSelectors {
  model: (s: any) => string | undefined;
  provider: (s: any) => string | undefined;
}

interface GenerationModelDropdownListProps {
  configSelectors: GenerationModelDropdownListConfigSelectors;
  enabledModelList: EnabledProviderWithModels[];
  ModelItemComponent: ComponentType<any>;
  useStore: (selector: (s: any) => any) => any;
}

const GenerationModelDropdownList = memo<GenerationModelDropdownListProps>(
  ({ useStore, configSelectors, enabledModelList, ModelItemComponent }) => {
    const { t } = useTranslation('components');
    const navigate = useNavigate();
    const ctx = useModelSwitchButtonContext();
    const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
    const { groupMode, handleGroupModeChange } = usePanelState();
    const [searchKeyword, setSearchKeyword] = useState('');

    const [currentModel, currentProvider] = useStore((s: any) => [
      configSelectors.model(s),
      configSelectors.provider(s),
    ]);
    const setModelAndProviderOnSelect = useStore((s: any) => s.setModelAndProviderOnSelect);

    const effectiveGroupMode = isDevMode ? groupMode : 'byModel';
    const listItems = useBuildListItems(enabledModelList, effectiveGroupMode, searchKeyword);
    const activeKey = currentProvider && currentModel ? menuKey(currentProvider, currentModel) : '';

    const handleModelChange = useCallback(
      (modelId: string, providerId: string) => {
        setModelAndProviderOnSelect(modelId, providerId);
      },
      [setModelAndProviderOnSelect],
    );

    const handleClose = useCallback(() => {
      ctx?.onClose();
    }, [ctx]);

    if (enabledModelList.length === 0) {
      return (
        <Flexbox
          horizontal
          className={modelSwitchPanelStyles.menuItem}
          gap={8}
          style={{ color: cssVar.colorTextTertiary }}
          onClick={() => {
            navigate('/settings/provider/all');
            handleClose();
          }}
        >
          {t('ModelSwitchPanel.emptyProvider')}
          <Icon icon={LucideArrowRight} />
        </Flexbox>
      );
    }

    return (
      <Flexbox>
        <Toolbar
          groupMode={groupMode}
          searchKeyword={searchKeyword}
          showGroupModeSwitch={isDevMode}
          onGroupModeChange={handleGroupModeChange}
          onSearchKeywordChange={setSearchKeyword}
        />
        <Flexbox className={modelSwitchPanelStyles.list}>
          {listItems.map((item: ListItem) => (
            <ListItemRenderer
              ModelItemComponent={ModelItemComponent}
              activeKey={activeKey}
              enabledList={enabledModelList}
              item={item}
              key={getListItemKey(item)}
              onClose={handleClose}
              onModelChange={handleModelChange}
            />
          ))}
        </Flexbox>
      </Flexbox>
    );
  },
);

GenerationModelDropdownList.displayName = 'GenerationModelDropdownList';

export default GenerationModelDropdownList;
