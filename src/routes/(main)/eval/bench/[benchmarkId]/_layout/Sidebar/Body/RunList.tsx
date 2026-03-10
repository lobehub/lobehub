'use client';

import { AccordionItem, Flexbox, Text } from '@lobehub/ui';
import { CheckCircle2, CircleDot, CircleSlash, Loader2, Play, XCircle } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { runSelectors, useEvalStore } from '@/store/eval';

const getRunIcon = (status?: string) => {
  switch (status) {
    case 'completed': {
      return CheckCircle2;
    }
    case 'running': {
      return Loader2;
    }
    case 'pending': {
      return CircleDot;
    }
    case 'failed': {
      return XCircle;
    }
    case 'aborted': {
      return CircleSlash;
    }
    default: {
      return Play;
    }
  }
};

interface RunListProps {
  activeKey: string;
  benchmarkId: string;
  itemKey: string;
}

const RunList = memo<RunListProps>(({ activeKey, benchmarkId, itemKey }) => {
  const { t } = useTranslation('eval');
  const navigate = useNavigate();
  const runList = useEvalStore(runSelectors.runList);
  const isLoading = useEvalStore(runSelectors.isLoadingRuns);

  const sortedRuns = useMemo(
    () =>
      [...runList].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [runList],
  );

  return (
    <AccordionItem
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Flexbox horizontal align="center" gap={4}>
          <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
            {t('sidebar.runs')}
          </Text>
          {runList.length > 0 && (
            <Text fontSize={11} type="secondary">
              {runList.length}
            </Text>
          )}
        </Flexbox>
      }
    >
      <Flexbox gap={1} paddingBlock={1}>
        {isLoading && runList.length === 0 ? (
          <SkeletonList rows={3} />
        ) : sortedRuns.length > 0 ? (
          sortedRuns.map((run) => (
            <Link
              key={run.id}
              to={`/eval/bench/${benchmarkId}/runs/${run.id}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/eval/bench/${benchmarkId}/runs/${run.id}`);
              }}
            >
              <NavItem
                active={activeKey === `run-${run.id}`}
                icon={getRunIcon(run.status)}
                iconSize={16}
                loading={run.status === 'running'}
                title={run.name || `Run ${run.id.slice(0, 8)}`}
              />
            </Link>
          ))
        ) : (
          <Text fontSize={12} style={{ padding: '8px 12px' }} type="secondary">
            {t('run.empty.title')}
          </Text>
        )}
      </Flexbox>
    </AccordionItem>
  );
});

export default RunList;
