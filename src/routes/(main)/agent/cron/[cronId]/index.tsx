'use client';

import { EDITOR_DEBOUNCE_TIME } from '@lobechat/const';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { useDebounceFn } from 'ahooks';
import { App, Empty, message } from 'antd';
import { type Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import useSWR from 'swr';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import Loading from '@/components/Loading/BrandTextLoading';
import { type UpdateAgentCronJobData } from '@/database/schemas/agentCronJob';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { mutate } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client/lambda';
import { agentCronJobService } from '@/services/agentCronJob';
import { topicService } from '@/services/topic';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { type ScheduleType } from './CronConfig';
import { buildCronPattern, parseCronPattern } from './CronConfig';
import CronJobContentEditor from './features/CronJobContentEditor';
import CronJobHeader from './features/CronJobHeader';
import CronJobSaveButton from './features/CronJobSaveButton';
import CronJobScheduleConfig from './features/CronJobScheduleConfig';

interface CronJobDraft {
  content: string;
  cronPattern: string;
  description: string;
  hourlyInterval?: number; // For hourly: interval in hours (1, 2, 6, 12)
  maxExecutions?: number | null;
  name: string;
  scheduleType: ScheduleType;
  timezone: string;
  triggerTime: Dayjs; // Trigger time (HH:mm)
  weekdays: number[]; // For weekly: selected days
}

type AutoSaveStatus = 'idle' | 'saving' | 'saved';
interface AutoSaveState {
  lastUpdatedTime: Date | null | any;
  status: AutoSaveStatus;
}

const autoSaveStore = {
  listeners: new Set<() => void>(),
  state: { lastUpdatedTime: null, status: 'idle' as AutoSaveStatus },
};

const getAutoSaveState = () => autoSaveStore.state;
const subscribeAutoSave = (listener: () => void) => {
  autoSaveStore.listeners.add(listener);
  return () => autoSaveStore.listeners.delete(listener);
};
const setAutoSaveState = (patch: Partial<AutoSaveState>) => {
  autoSaveStore.state = { ...autoSaveStore.state, ...patch };
  autoSaveStore.listeners.forEach((listener) => listener());
};
const useAutoSaveState = () =>
  useSyncExternalStore(subscribeAutoSave, getAutoSaveState, getAutoSaveState);

const AutoSaveHintSlot = memo(() => {
  const { lastUpdatedTime, status } = useAutoSaveState();
  return <AutoSaveHint lastUpdatedTime={lastUpdatedTime} saveStatus={status} />;
});

const resolveDate = (value?: Date | string | null) => {
  if (!value) return null;
  return typeof value === 'string' ? new Date(value) : value;
};

const CronJobDetailPage = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const { aid, cronId } = useParams<{ aid?: string; cronId?: string }>();
  const router = useQueryRoute();
  const { modal } = App.useApp();
  const enableRichRender = useUserStore(labPreferSelectors.enableInputMarkdown);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  const isNewJob = cronId === 'new';

  const [draft, setDraft] = useState<CronJobDraft | null>(null);
  const [isTogglingEnabled, setIsTogglingEnabled] = useState(false);
  const draftRef = useRef<CronJobDraft | null>(null);
  const contentRef = useRef('');
  const pendingSaveRef = useRef(false);
  const initializedIdRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const lastSavedNameRef = useRef<string | null>(null);
  const lastSavedPayloadRef = useRef<UpdateAgentCronJobData | null>(null);
  const lastSavedAtRef = useRef<Date | null>(null);
  const previousCronIdRef = useRef<string | null>(null);
  const hydratedAtRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);

  const [activeTopicId, refreshTopic, switchTopic] = useChatStore((s) => [
    s.activeTopicId,
    s.refreshTopic,
    s.switchTopic,
  ]);

  const [activeAgentId, internal_refreshCronTopics] = useAgentStore((s) => [
    s.activeAgentId,
    s.internal_refreshCronTopics,
  ]);
  const cronListAgentId = activeAgentId || aid;

  const { data: cronJob, isLoading } = useSWR(
    enableBusinessFeatures && cronId && !isNewJob ? ['cronJob', cronId] : null,
    async () => {
      if (!cronId || isNewJob) return null;
      const result = await agentCronJobService.getById(cronId);
      return result.success ? result.data : null;
    },
    {
      dedupingInterval: 0,
      revalidateIfStale: true,
      revalidateOnFocus: false,
      revalidateOnMount: true,
    },
  );

  const buildUpdateData = useCallback(
    (snapshot: CronJobDraft | null, content: string): UpdateAgentCronJobData | null => {
      if (!snapshot) return null;
      if (!snapshot.content) return null;
      if (!snapshot.name) return null;

      // Build cron pattern from schedule configuration
      const cronPattern = buildCronPattern(
        snapshot.scheduleType,
        snapshot.triggerTime,
        snapshot.hourlyInterval,
        snapshot.weekdays,
      );

      return {
        content,
        cronPattern,
        description: snapshot.description?.trim() || null,
        executionConditions: null, // No longer using executionConditions for time/weekdays
        maxExecutions: snapshot.maxExecutions ?? null,
        name: snapshot.name?.trim() || null,
        timezone: snapshot.timezone,
      };
    },
    [],
  );

  const refreshCronList = useCallback(() => {
    if (!cronListAgentId) return;
    void mutate(['cronTopicsWithJobInfo', cronListAgentId]);
  }, [cronListAgentId]);

  useEffect(() => {
    const prevCronId = previousCronIdRef.current;
    if (prevCronId && prevCronId !== cronId && lastSavedPayloadRef.current) {
      const payload = lastSavedPayloadRef.current;
      const updatedAt = lastSavedAtRef.current;
      mutate(
        ['cronJob', prevCronId],
        (current) =>
          current
            ? {
                ...current,
                ...payload,
                executionConditions: payload.executionConditions ?? null,
                ...(updatedAt ? { updatedAt } : null),
              }
            : current,
        false,
      );
    }

    previousCronIdRef.current = cronId ?? null;
    lastSavedPayloadRef.current = null;
    lastSavedAtRef.current = null;
    hydratedAtRef.current = null;
    isDirtyRef.current = false;
  }, [cronId]);

  const { run: debouncedSave, cancel: cancelDebouncedSave } = useDebounceFn(
    async () => {
      if (isNewJob) return; // Don't auto-save new jobs
      if (!cronId || initializedIdRef.current !== cronId) return;
      const payload = buildUpdateData(draftRef.current, contentRef.current);
      if (!payload) return;
      if (!payload.content || !payload.name) return;

      try {
        await agentCronJobService.update(cronId, payload);
        const savedAt = new Date();
        lastSavedPayloadRef.current = payload;
        lastSavedAtRef.current = savedAt;
        isDirtyRef.current = false;
        setAutoSaveState({ lastUpdatedTime: savedAt, status: 'saved' });
        const nextName = payload.name ?? null;
        if (nextName !== lastSavedNameRef.current) {
          lastSavedNameRef.current = nextName;
          refreshCronList();
        }
      } catch (error) {
        console.error('Failed to update cron job:', error);
        setAutoSaveState({ status: 'idle' });
        message.error('Failed to update scheduled task');
      }
    },
    { wait: EDITOR_DEBOUNCE_TIME },
  );

  useEffect(() => {
    cancelDebouncedSave();
    pendingSaveRef.current = false;
  }, [cancelDebouncedSave, cronId]);

  const scheduleSave = useCallback(() => {
    if (isNewJob) return; // Don't auto-save new jobs
    if (!readyRef.current || !draftRef.current) {
      pendingSaveRef.current = true;
      return;
    }
    isDirtyRef.current = true;
    setAutoSaveState({ status: 'saving' });
    debouncedSave();
  }, [debouncedSave, isNewJob]);

  const flushPendingSave = useCallback(() => {
    if (isNewJob) return; // Don't auto-save new jobs
    if (!pendingSaveRef.current || !draftRef.current) return;
    pendingSaveRef.current = false;
    isDirtyRef.current = true;
    setAutoSaveState({ status: 'saving' });
    debouncedSave();
  }, [debouncedSave, isNewJob]);

  const updateDraft = useCallback(
    (patch: Partial<CronJobDraft>) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        draftRef.current = next;
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const handleContentChange = useCallback(
    (content: string) => {
      contentRef.current = content;
      updateDraft({ content });
    },
    [updateDraft],
  );

  const handleToggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (!cronId) return;
      setIsTogglingEnabled(true);
      setAutoSaveState({ status: 'saving' });
      try {
        await agentCronJobService.update(cronId, { enabled });
        await mutate(
          ['cronJob', cronId],
          (current) => (current ? { ...current, enabled } : current),
          false,
        );
        await internal_refreshCronTopics();
        setAutoSaveState({ lastUpdatedTime: new Date(), status: 'saved' });
      } catch (error) {
        console.error('Failed to update cron job status:', error);
        setAutoSaveState({ status: 'idle' });
        message.error('Failed to update scheduled task');
      } finally {
        setIsTogglingEnabled(false);
      }
    },
    [cronId, internal_refreshCronTopics],
  );

  const handleDeleteCronJob = useCallback(async () => {
    if (!cronId) return;

    modal.confirm({
      cancelText: t('cancel', { ns: 'common' }),
      centered: true,
      content: t('agentCronJobs.confirmDeleteCronJob' as any),
      okButtonProps: { danger: true },
      okText: t('ok', { ns: 'common' }),
      onOk: async () => {
        try {
          let topicIds: string[] = [];
          if (aid) {
            const groups = await lambdaClient.topic.getCronTopicsGroupedByCronJob.query({
              agentId: aid,
            });
            const group = groups.find((item) => item.cronJobId === cronId);
            topicIds = group?.topics.map((topic) => topic.id) || [];
          }

          await agentCronJobService.delete(cronId);

          if (topicIds.length > 0) {
            await topicService.batchRemoveTopics(topicIds);
            await refreshTopic();
            if (activeTopicId && topicIds.includes(activeTopicId)) {
              switchTopic();
            }
          }

          if (cronListAgentId) {
            await mutate(['cronTopicsWithJobInfo', cronListAgentId]);
            router.push(`/agent/${cronListAgentId}`);
          } else {
            router.push('/');
          }
        } catch (error) {
          console.error('Failed to delete cron job:', error);
          message.error('Failed to delete scheduled task');
        }
      },
      title: t('agentCronJobs.deleteCronJob' as any),
    });
  }, [activeTopicId, cronId, cronListAgentId, modal, refreshTopic, router, switchTopic, t]);

  const handleSaveNewJob = useCallback(async () => {
    if (!aid) {
      message.error('Agent ID is required');
      return;
    }

    const payload = buildUpdateData(draftRef.current, contentRef.current);
    if (!payload) {
      message.error('Please fill in all required fields');
      return;
    }

    if (!payload.content || !payload.name || !payload.cronPattern) {
      message.error('Name and content are required');
      return;
    }

    setAutoSaveState({ status: 'saving' });
    try {
      const result = await agentCronJobService.create({
        agentId: aid,
        content: payload.content,
        cronPattern: payload.cronPattern,
        description: payload.description,
        enabled: true,
        executionConditions: payload.executionConditions,
        maxExecutions: payload.maxExecutions,
        name: payload.name,
        timezone: payload.timezone,
      });

      if (result.success && result.data) {
        setAutoSaveState({ lastUpdatedTime: new Date(), status: 'saved' });
        message.success('Scheduled task created successfully');
        refreshCronList();
        // Navigate to the newly created job
        router.push(`/agent/${aid}/cron/${result.data.id}`);
      } else {
        throw new Error('Failed to create job');
      }
    } catch (error) {
      console.error('Failed to create cron job:', error);
      setAutoSaveState({ status: 'idle' });
      message.error('Failed to create scheduled task');
    }
  }, [aid, buildUpdateData, refreshCronList, router]);

  // Initialize draft for new jobs
  useEffect(() => {
    if (!isNewJob || draft) return;

    // Get browser timezone
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const defaultDraft: CronJobDraft = {
      content: '',
      cronPattern: '0 0 * * *', // Default: daily at midnight
      description: '',
      maxExecutions: null,
      name: '',
      scheduleType: 'daily',
      timezone: browserTimezone,
      triggerTime: dayjs().hour(0).minute(0),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    };

    setDraft(defaultDraft);
    draftRef.current = defaultDraft;
    contentRef.current = '';
    readyRef.current = true;
  }, [isNewJob, draft]);

  useEffect(() => {
    if (!cronJob) return;
    const cronUpdatedAt = cronJob.updatedAt ? new Date(cronJob.updatedAt).toISOString() : null;
    const shouldHydrate =
      initializedIdRef.current !== cronJob.id ||
      (cronUpdatedAt !== hydratedAtRef.current && !isDirtyRef.current);

    if (!shouldHydrate) return;
    initializedIdRef.current = cronJob.id;
    hydratedAtRef.current = cronUpdatedAt;
    isDirtyRef.current = false;
    readyRef.current = false;
    lastSavedNameRef.current = cronJob.name ?? null;

    // Parse cron pattern to extract schedule configuration
    const parsed = parseCronPattern(cronJob.cronPattern);

    const nextDraft: CronJobDraft = {
      content: cronJob.content || '',
      cronPattern: cronJob.cronPattern,
      description: cronJob.description || '',
      hourlyInterval: parsed.hourlyInterval,
      maxExecutions: cronJob.maxExecutions ?? null,
      name: cronJob.name || '',
      scheduleType: parsed.scheduleType,
      timezone: cronJob.timezone || 'UTC',
      triggerTime: dayjs().hour(parsed.triggerHour).minute(parsed.triggerMinute),
      weekdays:
        parsed.scheduleType === 'weekly' && parsed.weekdays
          ? parsed.weekdays
          : [0, 1, 2, 3, 4, 5, 6], // Default: all days for weekly
    };

    setDraft(nextDraft);
    draftRef.current = nextDraft;

    contentRef.current = nextDraft.content;

    setAutoSaveState({
      lastUpdatedTime: resolveDate(cronJob.updatedAt),
      status: 'saved',
    });

    readyRef.current = true;
    flushPendingSave();
  }, [cronJob, flushPendingSave]);

  if (!enableBusinessFeatures) {
    return null;
  }

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={!isNewJob ? <AutoSaveHintSlot /> : undefined}
        right={
          !isNewJob ? (
            <ActionIcon
              icon={Trash2}
              title={t('delete', { ns: 'common' })}
              onClick={handleDeleteCronJob}
            />
          ) : undefined
        }
      />
      <Flexbox flex={1} style={{ overflowY: 'auto' }}>
        <WideScreenContainer paddingBlock={16}>
          {isLoading && <Loading debugId="CronJobDetailPage" />}
          {!isLoading && !cronJob && !isNewJob && (
            <Empty
              description={t('agentCronJobs.empty.description')}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
          {!isLoading && (cronJob || isNewJob) && draft && (
            <Flexbox gap={24}>
              <CronJobHeader
                enabled={cronJob?.enabled ?? false}
                isNewJob={isNewJob}
                isTogglingEnabled={isTogglingEnabled}
                name={draft.name}
                onNameChange={(name) => updateDraft({ name })}
                onToggleEnabled={handleToggleEnabled}
              />

              <CronJobScheduleConfig
                hourlyInterval={draft.hourlyInterval}
                maxExecutions={draft.maxExecutions}
                scheduleType={draft.scheduleType}
                timezone={draft.timezone}
                triggerTime={draft.triggerTime}
                weekdays={draft.weekdays}
                onScheduleChange={(updates) => updateDraft(updates)}
              />

              <CronJobContentEditor
                enableRichRender={enableRichRender}
                initialValue={cronJob?.content || ''}
                onChange={handleContentChange}
              />

              {isNewJob && (
                <CronJobSaveButton
                  disabled={!draft.name || !draft.content}
                  loading={false}
                  onSave={handleSaveNewJob}
                />
              )}
            </Flexbox>
          )}
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

export default CronJobDetailPage;
