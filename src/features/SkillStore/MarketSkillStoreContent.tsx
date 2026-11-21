'use client';

import { Flexbox, SearchBar } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import MarketSkillList from './SkillList/MarketSkills';

export const MarketSkillStoreContent = () => {
  const { t } = useTranslation('setting');
  const [keywords, setKeywords] = useState('');

  return (
    <Flexbox gap={12}>
      <SearchBar
        allowClear
        aria-label={t('skillView.search.placeholder')}
        placeholder={t('skillStore.search')}
        variant={'outlined'}
        onClear={() => setKeywords('')}
        onSearch={(value) => setKeywords(value.trim())}
      />
      <Flexbox height={'60vh'} style={{ marginInline: -16 }}>
        <MarketSkillList keywords={keywords} />
      </Flexbox>
    </Flexbox>
  );
};
