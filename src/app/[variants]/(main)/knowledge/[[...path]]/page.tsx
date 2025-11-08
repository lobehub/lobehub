'use client';

import dynamic from 'next/dynamic';

import { BrandTextLoading } from '@/components/Loading';

const KnowledgeRouter = dynamic(() => import('../KnowledgeRouter'), {
  loading: BrandTextLoading,
  ssr: false,
});

export default KnowledgeRouter;
