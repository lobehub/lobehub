'use client';

import dynamic from 'next/dynamic';

import { BrandTextLoading } from '@/components/Loading';

const DiscoverRouter = dynamic(() => import('../DiscoverRouter'), {
  loading: BrandTextLoading,
  ssr: false,
});

export default DiscoverRouter;
