'use client';

import { Flexbox, Icon, SearchBar, Select } from '@lobehub/ui';
import { ShapesIcon } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import { type CredFilter, type CredTypeFilterValue } from './credFilter';
import { CRED_TYPE_ICONS, CRED_TYPES } from './credTypes';

interface VaultFilterBarProps {
  onChange: (filter: CredFilter) => void;
  value: CredFilter;
}

/** The vault's search box and type filter, at the right of its header row. */
const VaultFilterBar: FC<VaultFilterBarProps> = ({ onChange, value }) => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <SearchBar
        allowClear
        placeholder={t('creds.searchPlaceholder')}
        style={{ width: 200 }}
        value={value.keyword ?? ''}
        variant={'filled'}
        onChange={(e) => onChange({ ...value, keyword: e.target.value })}
      />
      <Select
        aria-label={t('creds.typeFilter.label')}
        style={{ minWidth: 150 }}
        value={value.type ?? 'all'}
        variant={'filled'}
        options={(['all', ...CRED_TYPES] as CredTypeFilterValue[]).map((option) => ({
          label: (
            <Flexbox horizontal align={'center'} gap={6}>
              <Icon icon={option === 'all' ? ShapesIcon : CRED_TYPE_ICONS[option]} size={14} />
              {option === 'all' ? t('creds.typeFilter.all') : t(`creds.types.${option}`)}
            </Flexbox>
          ),
          value: option,
        }))}
        onChange={(next) => onChange({ ...value, type: next as CredTypeFilterValue })}
      />
    </Flexbox>
  );
};

export default VaultFilterBar;
