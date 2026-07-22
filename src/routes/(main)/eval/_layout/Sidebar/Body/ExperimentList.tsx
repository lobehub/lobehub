'use client';

import { AccordionItem, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Beaker, RotateCw } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useEvalStore } from '@/store/eval';
import { isModifierClick } from '@/utils/navigation';

interface ExperimentListProps {
  activeKey: string;
  itemKey: string;
}

const ExperimentList = memo<ExperimentListProps>(({ activeKey, itemKey }) => {
  const { t } = useTranslation('eval');
  const { t: tCommon } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();
  const experimentList = useEvalStore((s) => s.experimentList);
  const isInit = useEvalStore((s) => s.experimentListInit);
  const useFetchExperiments = useEvalStore((s) => s.useFetchExperiments);
  const { error, mutate } = useFetchExperiments();

  // Error gates before the skeleton: a failed fetch never settles `isInit`, so
  // without this branch the list would hang on SkeletonList forever (ux Feedback).
  const body = (() => {
    if (error && !isInit) {
      return (
        <Flexbox gap={4} padding={'8px 12px'}>
          <Text fontSize={12} type={'secondary'}>
            {t('experiment.list.error')}
          </Text>
          <Button icon={RotateCw} size={'small'} type={'text'} onClick={() => mutate()}>
            {tCommon('retry')}
          </Button>
        </Flexbox>
      );
    }

    if (!isInit) return <SkeletonList rows={3} />;

    if (experimentList.length === 0) {
      return (
        <Text fontSize={12} style={{ padding: '8px 12px' }} type="secondary">
          {t('experiment.empty')}
        </Text>
      );
    }

    return experimentList.map((experiment) => (
      <WorkspaceLink
        key={experiment.id}
        to={`/eval/experiments/${experiment.id}`}
        onClick={(e) => {
          if (isModifierClick(e)) return;
          e.preventDefault();
          navigate(`/eval/experiments/${experiment.id}`);
        }}
      >
        <NavItem
          active={activeKey === `experiment-${experiment.id}`}
          icon={Beaker}
          iconSize={16}
          title={experiment.name}
        />
      </WorkspaceLink>
    ));
  })();

  return (
    <AccordionItem
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Flexbox horizontal align="center" gap={4}>
          <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
            {t('sidebar.experiments')}
          </Text>
          {experimentList.length > 0 && (
            <Text fontSize={12} type="secondary">
              {experimentList.length}
            </Text>
          )}
        </Flexbox>
      }
    >
      <Flexbox gap={1} paddingBlock={1}>
        {body}
      </Flexbox>
    </AccordionItem>
  );
});

export default ExperimentList;
