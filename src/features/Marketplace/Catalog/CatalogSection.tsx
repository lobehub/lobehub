'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useInViewport } from 'ahooks';
import { memo, type ReactNode, type RefObject, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CatalogRowsSkeleton } from '@/components/Skeleton/MarketplaceCatalog';
import { SkillListVariantProvider } from '@/features/Settings/skill/features/SkillListRow';

import SectionHeading from './SectionHeading';
import { CATALOG_SECTION_SIZE } from './sections';
import { catalogStyles } from './styles';

/**
 * Whether a group has come near the viewport. A group fetches its preview only
 * then, so a long Discover page does not request every category at once; once
 * seen it stays loaded.
 */
export const useSeenOnce = (eager: boolean): [RefObject<HTMLElement | null>, boolean] => {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(eager);

  useInViewport(ref, {
    callback: (entry) => {
      if (entry.isIntersecting) setSeen(true);
    },
    rootMargin: '400px 0px',
  });

  return [ref, seen];
};

interface CatalogSectionProps {
  children?: ReactNode;
  count?: number;
  error?: unknown;
  label: string;
  loading: boolean;
  onRetry?: () => void;
  sectionRef?: RefObject<HTMLElement | null>;
  to?: string;
}

const CatalogSection = memo<CatalogSectionProps>(
  ({ children, count, error, label, loading, onRetry, sectionRef, to }) => {
    const { t } = useTranslation('discover');
    const id = useId();

    return (
      <section aria-labelledby={id} ref={sectionRef} {...stylex.props(catalogStyles.section)}>
        <SectionHeading
          count={count}
          id={id}
          label={label}
          to={count !== undefined && count > CATALOG_SECTION_SIZE ? to : undefined}
        />
        {error ? (
          <Flexbox horizontal align={'center'} gap={8} paddingInline={12}>
            <Text type={'secondary'}>{t('catalog.sectionError')}</Text>
            {onRetry && (
              <Button size={'small'} type={'link'} onClick={onRetry}>
                {t('catalog.retry')}
              </Button>
            )}
          </Flexbox>
        ) : loading ? (
          <CatalogRowsSkeleton />
        ) : (
          <SkillListVariantProvider value={'catalog'}>
            <div {...stylex.props(catalogStyles.grid)}>{children}</div>
          </SkillListVariantProvider>
        )}
      </section>
    );
  },
);

CatalogSection.displayName = 'MarketplaceCatalogSection';

export default CatalogSection;
