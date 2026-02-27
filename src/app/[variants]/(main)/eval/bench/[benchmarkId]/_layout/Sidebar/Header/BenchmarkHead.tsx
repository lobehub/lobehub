'use client';

import { type DropdownItem } from '@lobehub/ui';
import {
  ActionIcon,
  Block,
  Center,
  DropdownMenu,
  Skeleton,
  stopPropagation,
  Text,
} from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import {
  Activity,
  Award,
  BarChart3,
  ChevronsUpDownIcon,
  Gauge,
  LoaderPinwheel,
  Server,
  Target,
  TrendingUp,
  Trophy,
  Volleyball,
  Zap,
} from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useEvalStore } from '@/store/eval';

const SYSTEM_ICONS = [
  LoaderPinwheel,
  Volleyball,
  Server,
  Target,
  Award,
  Trophy,
  Activity,
  BarChart3,
  TrendingUp,
  Gauge,
  Zap,
];

const getSystemIcon = (id: string) => {
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return SYSTEM_ICONS[hash % SYSTEM_ICONS.length];
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  menuIcon: css`
    color: ${cssVar.colorTextTertiary};
  `,
}));

const BenchmarkHead = memo<{ id: string }>(({ id }) => {
  const navigate = useNavigate();
  const useFetchBenchmarks = useEvalStore((s) => s.useFetchBenchmarks);
  useFetchBenchmarks();
  const benchmark = useEvalStore((s) => s.benchmarkDetailMap[id]);
  const benchmarkList = useEvalStore((s) => s.benchmarkList);

  const name = benchmark?.name || benchmarkList.find((b: any) => b.id === id)?.name;
  const Icon = useMemo(() => getSystemIcon(id), [id]);

  const handleClick = useCallback(() => {
    navigate(`/eval/bench/${id}`);
  }, [id, navigate]);

  const handleBenchmarkSwitch = useCallback(
    (benchmarkId: string) => {
      setTimeout(() => {
        navigate(`/eval/bench/${benchmarkId}`);
      }, 0);
    },
    [navigate],
  );

  const menuItems = useMemo<DropdownItem[]>(() => {
    if (!benchmarkList || benchmarkList.length === 0) return [];

    return benchmarkList.map((b: any) => ({
      icon: (
        <Center className={styles.menuIcon} style={{ minWidth: 16 }} width={16}>
          {(() => {
            const BIcon = getSystemIcon(b.id);
            return <BIcon size={14} />;
          })()}
        </Center>
      ),
      key: b.id,
      label: b.name,
      onClick: () => handleBenchmarkSwitch(b.id),
      style: b.id === id ? { backgroundColor: 'var(--ant-control-item-bg-active)' } : {},
    }));
  }, [benchmarkList, handleBenchmarkSwitch, id, styles.menuIcon]);

  return (
    <Block
      clickable
      horizontal
      align={'center'}
      gap={8}
      padding={2}
      style={{ minWidth: 32, overflow: 'hidden' }}
      variant={'borderless'}
      onClick={handleClick}
    >
      <Center style={{ minWidth: 32 }} width={32}>
        <Icon size={18} />
      </Center>
      {!name ? (
        <Skeleton active paragraph={false} title={{ style: { marginBottom: 0 }, width: 80 }} />
      ) : (
        <DropdownMenu items={menuItems} placement="bottomRight">
          <Center
            horizontal
            gap={4}
            style={{ cursor: 'pointer', flex: 1, overflow: 'hidden' }}
            onClick={stopPropagation}
          >
            <Text ellipsis style={{ flex: 1 }} weight={500}>
              {name}
            </Text>
            <ActionIcon
              icon={ChevronsUpDownIcon}
              style={{ width: 24 }}
              size={{
                blockSize: 28,
                size: 16,
              }}
            />
          </Center>
        </DropdownMenu>
      )}
    </Block>
  );
});

BenchmarkHead.displayName = 'BenchmarkHead';

export default BenchmarkHead;
