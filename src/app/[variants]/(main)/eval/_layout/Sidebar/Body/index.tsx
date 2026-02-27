'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { LayoutDashboardIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import { usePathname } from '@/libs/router/navigation';
import { useEvalStore } from '@/store/eval';

import BenchmarkList from './BenchmarkList';

const useActiveKey = () => {
  const pathname = usePathname();
  if (pathname === '/eval') return 'dashboard';

  const match = pathname.match(/\/eval\/bench\/([^/]+)/);
  if (match) return `bench-${match[1]}`;

  return 'dashboard';
};

const Body = memo(() => {
  const activeKey = useActiveKey();
  const navigate = useNavigate();
  const { t } = useTranslation('eval');
  const useFetchBenchmarks = useEvalStore((s) => s.useFetchBenchmarks);
  useFetchBenchmarks();

  return (
    <Flexbox gap={8} paddingInline={4}>
      <Flexbox gap={1}>
        <Link
          onClick={(e) => {
            e.preventDefault();
            navigate('/eval');
          }}
          to="/eval"
        >
          <NavItem active={activeKey === 'dashboard'} icon={LayoutDashboardIcon} title={t('sidebar.dashboard')} />
        </Link>
      </Flexbox>
      <Accordion defaultExpandedKeys={['benchmarks']} gap={8}>
        <BenchmarkList activeKey={activeKey} itemKey="benchmarks" />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
