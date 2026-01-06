'use client';

import { memo } from 'react';

import PageTitle from '@/components/PageTitle';

const Title = memo(() => {
  return <PageTitle title="Pages" />;
});

Title.displayName = 'PageTitle';

export default Title;

