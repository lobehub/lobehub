import { ActionIcon, Center, Flexbox, Text, TooltipGroup } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ArrowDownUpIcon, ToggleLeft } from 'lucide-react';
import { use, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAiInfraStore } from '@/store/aiInfra';
import { aiModelSelectors } from '@/store/aiInfra/selectors';

import ModelItem from '../ModelItem';
import { ProviderSettingsContext } from '../ProviderSettingsContext';
import SortModelModal from '../SortModelModal';

interface EnabledModelListProps {
  activeTab: string;
}

const EnabledModelList = ({ activeTab }: EnabledModelListProps) => {
  const { t } = useTranslation('modelProvider');
  const { modelEditable } = use(ProviderSettingsContext);

  const enabledModels = useAiInfraStore(aiModelSelectors.enabledAiProviderModelList, isEqual);
  const batchToggleAiModels = useAiInfraStore((s) => s.batchToggleAiModels);
  const [open, setOpen] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);

  const isEmpty = enabledModels.length === 0;

  // Filter models based on active tab
  const filteredModels = useMemo(() => {
    if (activeTab === 'all') return enabledModels;
    return enabledModels.filter((model) => model.type === activeTab);
  }, [enabledModels, activeTab]);

  // Models that can be toggled (exclude embedding models when not editable)
  const togglableModels = useMemo(
    () =>
      modelEditable ? filteredModels : filteredModels.filter((model) => model.type !== 'embedding'),
    [filteredModels, modelEditable],
  );

  const isCurrentTabEmpty = filteredModels.length === 0;
  return (
    <>
      <Flexbox horizontal justify={'space-between'}>
        <Text style={{ fontSize: 12, marginTop: 8 }} type={'secondary'}>
          {t('providerModels.list.enabled')}
        </Text>
        {!isEmpty && (
          <TooltipGroup>
            <Flexbox horizontal>
              {togglableModels.length > 0 && (
                <ActionIcon
                  icon={ToggleLeft}
                  loading={batchLoading}
                  size={'small'}
                  title={t('providerModels.list.enabledActions.disableAll')}
                  onClick={async () => {
                    setBatchLoading(true);
                    await batchToggleAiModels(
                      togglableModels.map((i) => i.id),
                      false,
                    );
                    setBatchLoading(false);
                  }}
                />
              )}

              <ActionIcon
                icon={ArrowDownUpIcon}
                size={'small'}
                title={t('providerModels.list.enabledActions.sort')}
                onClick={() => {
                  setOpen(true);
                }}
              />
            </Flexbox>
          </TooltipGroup>
        )}
        {open && (
          <SortModelModal
            defaultItems={enabledModels}
            open={open}
            onCancel={() => {
              setOpen(false);
            }}
          />
        )}
      </Flexbox>

      {isEmpty ? (
        <Center padding={12}>
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {t('providerModels.list.enabledEmpty')}
          </Text>
        </Center>
      ) : isCurrentTabEmpty ? (
        <Center padding={12}>
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {t('providerModels.list.noModelsInCategory')}
          </Text>
        </Center>
      ) : (
        <TooltipGroup>
          <Flexbox gap={2}>
            {filteredModels.map(({ displayName, id, ...res }) => {
              const label = displayName || id;
              return (
                <ModelItem displayName={label as string} id={id as string} key={id} {...res} />
              );
            })}
          </Flexbox>
        </TooltipGroup>
      )}
    </>
  );
};
export default EnabledModelList;
