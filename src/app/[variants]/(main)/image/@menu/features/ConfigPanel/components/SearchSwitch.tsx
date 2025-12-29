'use client';

import { Switch } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';

const SearchSwitch = memo(() => {
  const { t } = useTranslation('image');

  const enabledSearch = useImageStore(imageGenerationConfigSelectors.enabledSearch);
  const isSupportSearch = useImageStore(imageGenerationConfigSelectors.isSupportSearch);
  const setEnabledSearch = useImageStore((s) => s.setEnabledSearch);

  // 如果当前模型不支持搜索，则不显示该开关
  if (!isSupportSearch) return null;

  return (
    <Flexbox align="center" horizontal justify="space-between">
      <span>{t('config.search.label')}</span>
      <Switch
        checked={enabledSearch}
        onChange={(checked) => setEnabledSearch(checked)}
        size="small"
      />
    </Flexbox>
  );
});

SearchSwitch.displayName = 'SearchSwitch';

export default SearchSwitch;
