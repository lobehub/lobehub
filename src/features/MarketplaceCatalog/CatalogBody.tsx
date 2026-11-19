import { Flexbox, Icon, Text } from '@lobehub/ui';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

interface CatalogBodyProps {
  allLabel: string;
  categories: ReactNode;
  categoryLabel?: string;
  featured: ReactNode;
  filtered: boolean;
  path: string;
  results: ReactNode;
  searching: boolean;
  sortControl: ReactNode;
}

export const CatalogBody = ({
  allLabel,
  categories,
  categoryLabel,
  filtered,
  searching,
  featured,
  path,
  results,
  sortControl,
}: CatalogBodyProps) => {
  const { t } = useTranslation('discover');

  return (
    <>
      {!filtered && featured}
      <Flexbox horizontal align="center" gap={8} justify="space-between" wrap="wrap">
        <Text as="h2" fontSize={20} weight={600}>
          {filtered
            ? searching
              ? t('catalog.searchResults')
              : (categoryLabel ?? allLabel)
            : t('catalog.browseCategories')}
        </Text>
        {filtered ? (
          <Flexbox horizontal align="center" gap={12}>
            {sortControl}
            <WorkspaceLink to={path}>{t('catalog.resetFilters')}</WorkspaceLink>
          </Flexbox>
        ) : (
          <WorkspaceLink
            style={{ alignItems: 'center', display: 'inline-flex', gap: 4 }}
            to={path + '?category=all'}
          >
            {allLabel}
            <Icon icon={ChevronRight} size={16} />
          </WorkspaceLink>
        )}
      </Flexbox>
      {filtered ? results : categories}
    </>
  );
};
