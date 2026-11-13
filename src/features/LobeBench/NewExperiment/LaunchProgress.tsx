'use client';

import { Flexbox, Progress, Text } from '@lobehub/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { LaunchProgress } from '../experimentLaunch';

export const LaunchProgressPanel = ({
  active,
  createdAt,
  progress,
}: {
  active: boolean;
  createdAt: string;
  progress: LaunchProgress;
}) => {
  const { t } = useTranslation('eval');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  // The launch's persisted timestamp survives remounts and resumes. The label
  // explicitly includes the time before a resume, not just this request's wait.
  const elapsedSeconds = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000));
  const elapsed = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
  const stages = {
    check: t('lobeBench.new.launch.stage.check'),
    complete: t('lobeBench.new.launch.stage.complete'),
    experiment: t('lobeBench.new.launch.stage.experiment'),
    metadata: t('lobeBench.new.launch.stage.metadata'),
    run: t('lobeBench.new.launch.stage.run'),
    start: t('lobeBench.new.launch.stage.start'),
  };
  const model = progress.contender?.config.model;

  return (
    <Flexbox gap={12}>
      <Flexbox aria-atomic aria-live={'polite'} gap={4} role={'status'}>
        <Text weight={500}>{stages[progress.stage]}</Text>
        {progress.contender && (
          <Text style={{ overflowWrap: 'anywhere' }}>
            {t('lobeBench.new.launch.currentRun', {
              index: progress.contenderIndex,
              name: progress.contender.name,
              total: progress.contenderCount,
            })}
          </Text>
        )}
        {typeof model === 'string' && model !== progress.contender?.name && (
          <Text fontSize={12} style={{ overflowWrap: 'anywhere' }} type={'secondary'}>
            {model}
          </Text>
        )}
      </Flexbox>
      <Progress
        percent={(progress.completedSteps / progress.totalSteps) * 100}
        showInfo={false}
        status={progress.status === 'failed' ? 'exception' : 'normal'}
        aria-label={t('lobeBench.new.launch.steps', {
          completed: progress.completedSteps,
          total: progress.totalSteps,
        })}
      />
      <Flexbox horizontal gap={8} justify={'space-between'} wrap={'wrap'}>
        <Text fontSize={12}>
          {t('lobeBench.new.launch.steps', {
            completed: progress.completedSteps,
            total: progress.totalSteps,
          })}
        </Text>
        <Text fontSize={12} style={{ fontVariantNumeric: 'tabular-nums' }} type={'secondary'}>
          {t('lobeBench.new.launch.elapsed', { elapsed })}
        </Text>
      </Flexbox>
      {active && (
        <Text fontSize={12} type={'secondary'}>
          {t('lobeBench.new.launch.waiting')}
        </Text>
      )}
    </Flexbox>
  );
};
