'use client';

import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AcceptanceChecks from '@/features/AgentGoals/Report/AcceptanceChecks';

import type { SharedGoalData } from './sharedGoalTypes';

type Acceptance = NonNullable<SharedGoalData['acceptance']>;

const Level = memo<{ acceptance: Acceptance; title: string }>(({ acceptance, title }) => {
  const { t } = useTranslation('chat');
  const met = acceptance.checks.filter((check) => check.passed).length;

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align={'baseline'} gap={12} wrap={'wrap'}>
        <Text weight={600}>{title}</Text>
        <Text fontSize={12} type={'secondary'}>
          {t('goalShare.acceptance.summary', { met, total: acceptance.checks.length })}
        </Text>
      </Flexbox>
      <AcceptanceChecks checks={acceptance.checks} />
    </Flexbox>
  );
});

Level.displayName = 'SharedGoalAcceptanceLevel';

/** The Acceptance results: the Goal-level one first, then each task's own. */
const SharedGoalAcceptance = memo<{ view: SharedGoalData }>(({ view }) => {
  const { t } = useTranslation('chat');
  const tasks = view.nodes.flatMap((node) =>
    node.acceptance && node.title !== GOAL_ACCEPTANCE_TASK_TITLE
      ? [{ acceptance: node.acceptance, id: node.id, title: node.title }]
      : [],
  );

  return (
    <Flexbox gap={16} id={'acceptance'}>
      <Text fontSize={20} weight={600}>
        {t('goalShare.acceptance.title')}
      </Text>
      {!view.acceptance && tasks.length === 0 ? (
        <Text type={'secondary'}>{t('goalShare.acceptance.empty')}</Text>
      ) : (
        <>
          {view.acceptance && (
            <Level acceptance={view.acceptance} title={t('goalShare.acceptance.goalLevel')} />
          )}
          {tasks.length > 0 && (
            <Flexbox gap={16}>
              <Text type={'secondary'}>{t('goalShare.acceptance.taskLevel')}</Text>
              {tasks.map((task) => (
                <Level acceptance={task.acceptance} key={task.id} title={task.title} />
              ))}
            </Flexbox>
          )}
        </>
      )}
    </Flexbox>
  );
});

SharedGoalAcceptance.displayName = 'SharedGoalAcceptance';

export default SharedGoalAcceptance;
