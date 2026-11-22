'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Flexbox, SearchBar, Segmented } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type FC, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { countCredsByType, type CredFilter, type CredTypeFilterValue } from './credFilter';
import { CRED_TYPES } from './credTypes';

const styles = stylex.create({
  count: { marginInlineStart: '6px', color: cssVar.colorTextTertiary },
});

interface VaultFilterBarProps {
  /** More filters after the search box, e.g. the workspace visibility filter. */
  children?: ReactNode;
  /** The rows the tabs count, already narrowed by any other page filter. */
  creds: UserCredSummary[];
  onChange: (filter: CredFilter) => void;
  value: CredFilter;
}

/**
 * The vault's filter row, under the tabs and the create button: one tab per
 * credential type with its count on the left, the search box (and any extra
 * filters) on the right.
 */
const VaultFilterBar: FC<VaultFilterBarProps> = ({ children, creds, onChange, value }) => {
  const { t } = useTranslation('setting');
  const counts = countCredsByType(creds, value.keyword);

  return (
    <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
      <Segmented
        value={value.type ?? 'all'}
        options={(['all', ...CRED_TYPES] as CredTypeFilterValue[]).map((option) => ({
          label: (
            <span>
              {t(`creds.types.${option}`)}
              <span {...stylex.props(styles.count)}>{counts[option]}</span>
            </span>
          ),
          value: option,
        }))}
        onChange={(next) => onChange({ ...value, type: next as CredTypeFilterValue })}
      />
      {/* Takes the rest of the row and shrinks the search box before wrapping,
          so the tabs, search and visibility filter share one line at settings
          widths; a very narrow pane still wraps each control onto its own line. */}
      <Flexbox
        horizontal
        align={'center'}
        gap={8}
        justify={'flex-end'}
        style={{ flex: '1 1 auto' }}
        wrap={'wrap'}
      >
        <SearchBar
          allowClear
          placeholder={t('creds.searchPlaceholder')}
          style={{ flex: '1 1 140px', maxWidth: 240, minWidth: 140 }}
          value={value.keyword ?? ''}
          variant={'filled'}
          onChange={(e) => onChange({ ...value, keyword: e.target.value })}
        />
        {children}
      </Flexbox>
    </Flexbox>
  );
};

export default VaultFilterBar;
