'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useInViewport } from 'ahooks';
import { memo, type ReactNode, type RefObject, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonBar from '@/components/Skeleton/Bar';
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

const RowSkeleton = () => (
  <Flexbox horizontal align={'center'} gap={12} paddingBlock={8} paddingInline={12}>
    <SkeletonBar height={36} width={36} />
    <Flexbox flex={1} gap={6}>
      <SkeletonBar height={14} width={'40%'} />
      <SkeletonBar height={12} width={'70%'} />
    </Flexbox>
  </Flexbox>
);

export const CatalogRowsSkeleton = ({ count = CATALOG_SECTION_SIZE }: { count?: number }) => (
  <div aria-busy {...stylex.props(catalogStyles.grid)}>
    {Array.from({ length: count }, (_, index) => (
      <RowSkeleton key={index} />
    ))}
  </div>
);

interface CatalogSectionProps {
  children?: ReactNode;
  error?: unknown;
  label: string;
  loading: boolean;
  onRetry?: () => void;
  sectionRef?: RefObject<HTMLElement | null>;
  /** The full list behind the heading. */
  to: string;
}

/** One Discover group: a linked heading over a two-column preview of its rows. */
const CatalogSection = memo<CatalogSectionProps>(
  ({ children, error, label, loading, onRetry, sectionRef, to }) => {
    const { t } = useTranslation('discover');

    return (
      <section ref={sectionRef} {...stylex.props(catalogStyles.section)}>
        <SectionHeading label={label} linkLabel={`${label} · ${t('catalog.viewAll')}`} to={to} />
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
          <SkillListVariantProvider value={'page'}>
            <div {...stylex.props(catalogStyles.grid)}>{children}</div>
          </SkillListVariantProvider>
        )}
      </section>
    );
  },
);

CatalogSection.displayName = 'MarketplaceCatalogSection';

export default CatalogSection;
