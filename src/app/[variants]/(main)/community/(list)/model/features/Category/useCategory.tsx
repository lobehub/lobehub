import { ProviderIcon } from '@lobehub/icons';
import { uniqBy } from 'es-toolkit/compat';
import { LayoutPanelTopIcon } from 'lucide-react';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export const useCategory = () => {
  const { t } = useTranslation('discover');

  const items = useMemo(
    () =>
      uniqBy(DEFAULT_MODEL_PROVIDER_LIST, (item) => item.id).map((item) => {
        return {
          icon: <ProviderIcon provider={item.id} size={18} type={'mono'} />,
          key: item.id,
          label: item.name,
        };
      }),
    [],
  );

  return useMemo(
    () => [
      {
        icon: LayoutPanelTopIcon,
        key: 'all',
        label: t('mcp.categories.all.name'),
      },
      ...items,
    ],
    [t, items],
  );
};

export const useCategoryItem = (key?: string) => {
  const items = useCategory();
  if (!key) return;
  return items.find((item) => item.key === key);
};
