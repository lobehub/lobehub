'use client';

import { Flexbox, Icon, SearchBar, Select } from '@lobehub/ui';
import { ShapesIcon } from 'lucide-react';
import { type FC, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { type CredFilter, type CredTypeFilterValue } from './credFilter';
import { CRED_TYPE_ICONS, CRED_TYPES } from './credTypes';

interface VaultFilterBarProps {
  /** More filters after the type filter, e.g. the workspace visibility filter. */
  children?: ReactNode;
  onChange: (filter: CredFilter) => void;
  value: CredFilter;
}

/**
 * The vault's filter row, under the tabs and the create button: the search box
 * on the left, the type filter (and any extra filters) on the right. It has a
 * row of its own so the header keeps the tabs and the create button on one line
 * at settings widths.
 */
const VaultFilterBar: FC<VaultFilterBarProps> = ({ children, onChange, value }) => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
      <SearchBar
        allowClear
        placeholder={t('creds.searchPlaceholder')}
        style={{ maxWidth: 320, minWidth: 200, flex: 1 }}
        value={value.keyword ?? ''}
        variant={'filled'}
        onChange={(e) => onChange({ ...value, keyword: e.target.value })}
      />
      <Flexbox horizontal align={'center'} gap={8}>
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
        {children}
      </Flexbox>
    </Flexbox>
  );
};

export default VaultFilterBar;
