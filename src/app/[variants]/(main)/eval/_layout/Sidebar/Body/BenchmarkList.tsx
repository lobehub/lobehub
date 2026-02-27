'use client';

import { AccordionItem, Flexbox, Text } from '@lobehub/ui';
import { Activity, Award, BarChart3, Gauge, LoaderPinwheel, Server, Target, TrendingUp, Trophy, Volleyball, Zap } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useEvalStore } from '@/store/eval';

const SYSTEM_ICONS = [LoaderPinwheel, Volleyball, Server, Target, Award, Trophy, Activity, BarChart3, TrendingUp, Gauge, Zap];

const getSystemIcon = (id: string) => {
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return SYSTEM_ICONS[hash % SYSTEM_ICONS.length];
};

interface BenchmarkListProps {
  activeKey: string;
  itemKey: string;
}

const BenchmarkList = memo<BenchmarkListProps>(({ activeKey, itemKey }) => {
  const { t } = useTranslation('eval');
  const navigate = useNavigate();
  const benchmarkList = useEvalStore((s) => s.benchmarkList);
  const isInit = useEvalStore((s) => s.benchmarkListInit);

  return (
    <AccordionItem
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Flexbox align="center" gap={4} horizontal>
          <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
            {t('sidebar.benchmarks')}
          </Text>
          {benchmarkList.length > 0 && (
            <Text fontSize={11} type="secondary">
              {benchmarkList.length}
            </Text>
          )}
        </Flexbox>
      }
    >
      <Flexbox gap={1} paddingBlock={1}>
        {!isInit ? (
          <SkeletonList rows={3} />
        ) : benchmarkList.length > 0 ? (
          benchmarkList.map((b: any) => (
            <Link
              key={b.id}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/eval/bench/${b.id}`);
              }}
              to={`/eval/bench/${b.id}`}
            >
              <NavItem
                active={activeKey === `bench-${b.id}`}
                icon={getSystemIcon(b.id)}
                iconSize={16}
                title={b.name}
              />
            </Link>
          ))
        ) : (
          <Text
            fontSize={12}
            style={{ padding: '8px 12px' }}
            type="secondary"
          >
            {t('benchmark.empty')}
          </Text>
        )}
      </Flexbox>
    </AccordionItem>
  );
});

export default BenchmarkList;
