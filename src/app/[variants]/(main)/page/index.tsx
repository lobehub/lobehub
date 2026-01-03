'use client';

import { Suspense, memo } from 'react';
import { useParams } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import PageExplorer from '@/features/PageExplorer';
import { standardizeIdentifier } from '@/utils/identifier';

import PageTitle from './features/PageTitle';

/**
 * Pages route - dedicated page for managing documents/pages
 * This is extracted from the /resource route to have its own dedicated space
 */
const PagesPage = memo(() => {
  const { id } = useParams<{ id: string }>();

  return (
    <>
      <PageTitle />
      <Suspense fallback={<Loading debugId="PagesPage" />}>
        <PageExplorer pageId={standardizeIdentifier(id ?? '', 'docs')} />
      </Suspense>
    </>
  );
});

PagesPage.displayName = 'PagesPage';

export default PagesPage;
