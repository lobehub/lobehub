'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { LOBE_BENCH_PATH } from '@/features/LobeBench/lobeBench';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

/**
 * Lobe Bench sits next to the Evaluation Lab under the one `/eval` entry (the
 * segmented switch at the top), so its breadcrumb is its own name, like the
 * Lab's is — not a step below the Lab.
 */
const Header = memo(() => {
  const { t } = useTranslation('eval');
  return (
    <SideBarHeaderLayout breadcrumb={[{ href: LOBE_BENCH_PATH, title: t('lobeBench.title') }]} />
  );
});

export default Header;
