'use client';

import { Alert, Block, Button, Flexbox, Text } from '@lobehub/ui';
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import {
  backgroundLaunchKey,
  findSavedExperimentLaunch,
  getBackgroundLaunch,
  startBackgroundLaunch,
  subscribeBackgroundLaunch,
} from '../launchBackground';
import { launchServices } from '../launchServices';
import { LOBE_BENCH_PATH } from '../lobeBench';
import { LaunchProgressPanel } from '../NewExperiment/LaunchProgress';
import { useLobeBenchExperiments } from '../useLobeBench';

export const LaunchPage = ({ children }: { children: ReactNode }) => {
  const { experimentId = '' } = useParams<{ experimentId: string }>();
  const userId = useUserStore(userProfileSelectors.userId);
  const workspaceId = useActiveWorkspaceId();
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation('eval');
  const { mutate } = useLobeBenchExperiments();
  const key = backgroundLaunchKey(userId ?? '', workspaceId, experimentId);
  const state = useSyncExternalStore(
    subscribeBackgroundLaunch,
    () => getBackgroundLaunch(key),
    () => undefined,
  );
  // Scope the checkpoint to the current account and route, including after navigation.
  const saved = userId ? findSavedExperimentLaunch(userId, workspaceId, experimentId) : undefined;
  const record = state?.record ?? saved;
  const [recovering, setRecovering] = useState(false);
  const [, refreshCheckpoint] = useState(0);
  useEffect(() => {
    const update = () => refreshCheckpoint((value) => value + 1);
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);
  const hasState = !!state;
  useEffect(() => {
    if (!hasState) return;
    void mutate();
  }, [hasState, state?.active, state?.outcome, mutate]);
  if (!record || state?.outcome?.complete) return children;
  const active = state?.active || recovering;
  const error =
    state?.error === 'launch_busy'
      ? t('lobeBench.new.launch.busy')
      : (state?.error ?? state?.outcome?.error?.message);
  const resume = async () => {
    if (!userId || active) return;
    setRecovering(true);
    try {
      await startBackgroundLaunch(
        { benchmarkId: record.benchmarkId, userId, workspaceId },
        record,
        launchServices,
      );
    } catch {
      /* Displayed through the shared launch state. */
    } finally {
      setRecovering(false);
    }
  };
  return (
    <Flexbox gap={20} padding={32}>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        <Text as={'h1'} fontSize={24} weight={600}>
          {record.name}
        </Text>
        <Button onClick={() => navigate(LOBE_BENCH_PATH)}>{t('lobeBench.new.launch.back')}</Button>
      </Flexbox>
      <Block padding={24}>
        <Flexbox gap={16}>
          <Text weight={600}>
            {t(active ? 'lobeBench.new.launch.title' : 'lobeBench.new.launch.interrupted')}
          </Text>
          {state?.progress && (
            <LaunchProgressPanel
              active={!!active}
              createdAt={record.createdAt}
              progress={state.progress}
            />
          )}
          {error && <Alert title={error} type={'warning'} />}
          {!active && (
            <>
              <Text>{t('lobeBench.new.launch.recovery')}</Text>
              <Button onClick={resume}>{t('lobeBench.new.launch.recheck')}</Button>
            </>
          )}
        </Flexbox>
      </Block>
      {(state?.progress?.stage === 'start' || state?.outcome?.metadataSaved) && children}
    </Flexbox>
  );
};
