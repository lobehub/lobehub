'use client';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { EDITOR_DEBOUNCE_TIME } from '@lobechat/const';
import {
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  ReactLinkPlugin,
  ReactListPlugin,
  ReactMathPlugin,
  ReactTablePlugin,
} from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';
import { ActionIcon, Flexbox, Icon, Input, Tag, Text } from '@lobehub/ui';
import { useDebounceFn } from 'ahooks';
import { App, Card, Checkbox, Empty, InputNumber, Select, Switch, TimePicker, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { Clock, Trash2 } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import useSWR from 'swr';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import Loading from '@/components/Loading/BrandTextLoading';
import type { ExecutionConditions, UpdateAgentCronJobData } from '@/database/schemas/agentCronJob';
import TypoBar from '@/features/EditorModal/Typobar';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { mutate } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client/lambda';
import { agentCronJobService } from '@/services/agentCronJob';
import { topicService } from '@/services/topic';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

interface CronJobDraft {
  content: string;
  cronPattern: string;
  description: string;
  maxExecutions?: number | null;
  maxExecutionsPerDay?: number | null;
  name: string;
  timeRange?: [Dayjs, Dayjs];
  weekdays: number[];
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

// Standard cron format: minute hour day month weekday
const CRON_PATTERNS = [
  { label: 'agentCronJobs.interval.30min', value: '*/30 * * * *' },
  { label: 'agentCronJobs.interval.1hour', value: '0 * * * *' },
  { label: 'agentCronJobs.interval.2hours', value: '0 */2 * * *' },
  { label: 'agentCronJobs.interval.6hours', value: '0 */6 * * *' },
  { label: 'agentCronJobs.interval.12hours', value: '0 */12 * * *' },
  { label: 'agentCronJobs.interval.daily', value: '0 0 * * *' },
  { label: 'agentCronJobs.interval.weekly', value: '0 0 * * 0' },
];

const WEEKDAY_OPTIONS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

const WEEKDAY_LABELS: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

const getIntervalText = (cronPattern: string) => {
  // Standard cron format mapping
  const intervalMap: Record<string, string> = {
    '*/30 * * * *': 'agentCronJobs.interval.30min',
    '0 * * * *': 'agentCronJobs.interval.1hour',
    '0 */12 * * *': 'agentCronJobs.interval.12hours',
    '0 */2 * * *': 'agentCronJobs.interval.2hours',
    '0 */6 * * *': 'agentCronJobs.interval.6hours',
    '0 0 * * *': 'agentCronJobs.interval.daily',
    '0 0 * * 0': 'agentCronJobs.interval.weekly',
  };

  return intervalMap[cronPattern] || cronPattern;
};

const resolveDate = (value?: Date | string | null) => {
  if (!value) return null;
  return typeof value === 'string' ? new Date(value) : value;
};

const CronJobDetailPage = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const { aid, cronId } = useParams<{ aid?: string; cronId?: string }>();
  const router = useQueryRoute();
  const { modal } = App.useApp();
  const editor = useEditor();
  const enableRichRender = useUserStore(labPreferSelectors.enableInputMarkdown);
  const [editorReady, setEditorReady] = useState(false);

  const [draft, setDraft] = useState<CronJobDraft | null>(null);
  const draftRef = useRef<CronJobDraft | null>(null);
  const contentRef = useRef('');
  const pendingContentRef = useRef<string | null>(null);
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

  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const cronListAgentId = activeAgentId || aid;

  const { data: cronJob, isLoading } = useSWR(
    ENABLE_BUSINESS_FEATURES && cronId ? ['cronJob', cronId] : null,
    async () => {
      if (!cronId) return null;
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

  const resolvedCronPattern = draft ? draft.cronPattern : cronJob?.cronPattern;
  const resolvedWeekdays = draft ? draft.weekdays : cronJob?.executionConditions?.weekdays || [];
  const resolvedTimeRange = draft
    ? draft.timeRange
    : cronJob?.executionConditions?.timeRange
      ? [
          dayjs(cronJob.executionConditions.timeRange.start, 'HH:mm'),
          dayjs(cronJob.executionConditions.timeRange.end, 'HH:mm'),
        ]
      : undefined;

  const summaryTags = useMemo(() => {
    const tags: Array<{ key: string; label: string }> = [];

    if (resolvedCronPattern) {
      tags.push({
        key: 'interval',
        label: t(getIntervalText(resolvedCronPattern) as any),
      });
    }

    if (resolvedWeekdays.length > 0) {
      tags.push({
        key: 'weekdays',
        label: resolvedWeekdays.map((day) => WEEKDAY_LABELS[day]).join(', '),
      });
    }

    if (resolvedTimeRange && resolvedTimeRange.length === 2) {
      tags.push({
        key: 'timeRange',
        label: `${resolvedTimeRange[0].format('HH:mm')} - ${resolvedTimeRange[1].format('HH:mm')}`,
      });
    }

    return tags;
  }, [resolvedCronPattern, resolvedTimeRange, resolvedWeekdays, t]);

  const buildUpdateData = useCallback(
    (snapshot: CronJobDraft | null, content: string): UpdateAgentCronJobData | null => {
      if (!snapshot) return null;
      if (!snapshot.content) return null;
      if (!snapshot.name) return null;

      const executionConditions: ExecutionConditions = {};
      if (snapshot.timeRange && snapshot.timeRange.length === 2) {
        executionConditions.timeRange = {
          end: snapshot.timeRange[1].format('HH:mm'),
          start: snapshot.timeRange[0].format('HH:mm'),
        };
      }

      if (snapshot.weekdays && snapshot.weekdays.length > 0) {
        executionConditions.weekdays = snapshot.weekdays;
      }

      if (snapshot.maxExecutionsPerDay) {
        executionConditions.maxExecutionsPerDay = snapshot.maxExecutionsPerDay;
      }

      return {
        content,
        cronPattern: snapshot.cronPattern,
        description: snapshot.description?.trim() || null,
        executionConditions:
          Object.keys(executionConditions).length > 0 ? executionConditions : null,
        maxExecutions: snapshot.maxExecutions ?? null,
        name: snapshot.name?.trim() || null,
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
    if (!readyRef.current || !draftRef.current) {
      pendingSaveRef.current = true;
      return;
    }
    isDirtyRef.current = true;
    setAutoSaveState({ status: 'saving' });
    debouncedSave();
  }, [debouncedSave]);

  const flushPendingSave = useCallback(() => {
    if (!pendingSaveRef.current || !draftRef.current) return;
    pendingSaveRef.current = false;
    isDirtyRef.current = true;
    setAutoSaveState({ status: 'saving' });
    debouncedSave();
  }, [debouncedSave]);

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

  const handleContentChange = useCallback(() => {
    if (!readyRef.current || !editor || !editorReady) return;
    const nextContent = enableRichRender
      ? (editor.getDocument('markdown') as unknown as string)
      : (editor.getDocument('text') as unknown as string);
    contentRef.current = nextContent || '';
    scheduleSave();
  }, [editor, editorReady, enableRichRender, scheduleSave]);

  const handleToggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (!cronId) return;
      setAutoSaveState({ status: 'saving' });
      try {
        await agentCronJobService.update(cronId, { enabled });
        setAutoSaveState({ lastUpdatedTime: new Date(), status: 'saved' });
      } catch (error) {
        console.error('Failed to update cron job status:', error);
        setAutoSaveState({ status: 'idle' });
        message.error('Failed to update scheduled task');
      }
    },
    [cronId, mutate, refreshCronList],
  );

  const handleDeleteCronJob = useCallback(() => {
    if (!cronId) return;

    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
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
      title: t('agentCronJobs.confirmDelete'),
    });
  }, [activeTopicId, cronId, cronListAgentId, modal, refreshTopic, router, switchTopic, t]);

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

    const nextDraft: CronJobDraft = {
      content: cronJob.content || '',
      cronPattern: cronJob.cronPattern,
      description: cronJob.description || '',
      maxExecutions: cronJob.maxExecutions ?? null,
      maxExecutionsPerDay: cronJob.executionConditions?.maxExecutionsPerDay ?? null,
      name: cronJob.name || '',
      timeRange: cronJob.executionConditions?.timeRange
        ? [
            dayjs(cronJob.executionConditions.timeRange.start, 'HH:mm'),
            dayjs(cronJob.executionConditions.timeRange.end, 'HH:mm'),
          ]
        : undefined,
      weekdays: cronJob.executionConditions?.weekdays || [],
    };

    setDraft(nextDraft);
    draftRef.current = nextDraft;

    contentRef.current = nextDraft.content;
    pendingContentRef.current = nextDraft.content;

    setAutoSaveState({
      lastUpdatedTime: resolveDate(cronJob.updatedAt),
      status: 'saved',
    });

    if (editorReady && editor) {
      try {
        setTimeout(() => {
          editor.setDocument(enableRichRender ? 'markdown' : 'text', nextDraft.content);
        }, 100);
        pendingContentRef.current = null;
        readyRef.current = true;
        flushPendingSave();
      } catch (error) {
        console.error('[CronJobDetailPage] Failed to init editor content:', error);
        setTimeout(() => {
          editor.setDocument(enableRichRender ? 'markdown' : 'text', nextDraft.content);
        }, 100);
      }
    }
  }, [cronJob, editor, editorReady, enableRichRender]);

  useEffect(() => {
    if (!editorReady || !editor || pendingContentRef.current === null) return;
    try {
      setTimeout(() => {
        editor.setDocument(enableRichRender ? 'markdown' : 'text', pendingContentRef.current);
      }, 100);
      pendingContentRef.current = null;
      readyRef.current = true;
      flushPendingSave();
    } catch (error) {
      console.error('[CronJobDetailPage] Failed to init editor content:', error);
      setTimeout(() => {
        console.log('setDocument timeout', pendingContentRef.current);
        editor.setDocument(enableRichRender ? 'markdown' : 'text', pendingContentRef.current);
      }, 100);
    }
  }, [editor, editorReady, enableRichRender]);

  if (!ENABLE_BUSINESS_FEATURES) {
    return null;
  }

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader left={<AutoSaveHintSlot />} />
      <Flexbox flex={1} style={{ overflowY: 'auto' }}>
        <WideScreenContainer paddingBlock={16}>
          {isLoading && <Loading debugId="CronJobDetailPage" />}
          {!isLoading && !cronJob && (
            <Empty
              description={t('agentCronJobs.empty.description')}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
          {!isLoading && cronJob && (
            <Flexbox gap={24}>
              <Flexbox align="center" gap={16} horizontal justify="space-between">
                <Flexbox gap={6} style={{ flex: 1, minWidth: 0 }}>
                  <Input
                    onChange={(e) => updateDraft({ name: e.target.value })}
                    placeholder={t('agentCronJobs.form.name.placeholder')}
                    style={{
                      fontSize: 28,
                      fontWeight: 600,
                      padding: 0,
                    }}
                    value={draft?.name ?? cronJob.name ?? ''}
                    variant={'borderless'}
                  />
                </Flexbox>
                <Flexbox align="center" gap={8} horizontal>
                  <ActionIcon
                    icon={Trash2}
                    onClick={handleDeleteCronJob}
                    size={'small'}
                    title={t('delete', { ns: 'common' })}
                  />
                  <Text type="secondary">
                    {t(
                      cronJob?.enabled
                        ? 'agentCronJobs.status.enabled'
                        : 'agentCronJobs.status.disabled',
                    )}
                  </Text>
                  <Switch
                    defaultChecked={cronJob?.enabled ?? false}
                    disabled={!cronJob}
                    key={cronJob?.id ?? 'cron-switch'}
                    onChange={handleToggleEnabled}
                    size="small"
                  />
                </Flexbox>
              </Flexbox>

              <Card size="small" style={{ borderRadius: 12 }} styles={{ body: { padding: 12 } }}>
                <Flexbox gap={12}>
                  {summaryTags.length > 0 && (
                    <Flexbox align="center" gap={8} horizontal style={{ flexWrap: 'wrap' }}>
                      {summaryTags.map((tag) => (
                        <Tag key={tag.key} variant={'filled'}>
                          {tag.label}
                        </Tag>
                      ))}
                    </Flexbox>
                  )}

                  <Flexbox align="center" gap={8} horizontal style={{ flexWrap: 'wrap' }}>
                    <Tag variant={'borderless'}>{t('agentCronJobs.schedule')}</Tag>
                    <Select
                      onChange={(value) => updateDraft({ cronPattern: value })}
                      options={CRON_PATTERNS.map((pattern) => ({
                        label: t(pattern.label as any),
                        value: pattern.value,
                      }))}
                      size="small"
                      style={{ minWidth: 160 }}
                      value={draft?.cronPattern ?? cronJob.cronPattern}
                    />
                    <TimePicker.RangePicker
                      format="HH:mm"
                      onChange={(value) =>
                        updateDraft({
                          timeRange:
                            value && value.length === 2
                              ? [value[0] as Dayjs, value[1] as Dayjs]
                              : undefined,
                        })
                      }
                      placeholder={[
                        t('agentCronJobs.form.timeRange.start'),
                        t('agentCronJobs.form.timeRange.end'),
                      ]}
                      size="small"
                      value={
                        draft?.timeRange ??
                        (resolvedTimeRange as [Dayjs, Dayjs] | undefined) ??
                        null
                      }
                    />
                    <Checkbox.Group
                      onChange={(values) => updateDraft({ weekdays: values as number[] })}
                      options={WEEKDAY_OPTIONS}
                      style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
                      value={draft?.weekdays ?? resolvedWeekdays}
                    />
                  </Flexbox>

                  <Flexbox align="center" gap={8} horizontal style={{ flexWrap: 'wrap' }}>
                    <Tag variant={'borderless'}>{t('agentCronJobs.maxExecutions')}</Tag>
                    <InputNumber
                      min={1}
                      onChange={(value) => updateDraft({ maxExecutions: value ?? null })}
                      placeholder={t('agentCronJobs.form.maxExecutions.placeholder')}
                      size="small"
                      style={{ width: 160 }}
                      value={draft?.maxExecutions ?? cronJob.maxExecutions ?? null}
                    />
                  </Flexbox>
                </Flexbox>
              </Card>

              <Flexbox gap={12}>
                <Flexbox align="center" gap={6} horizontal>
                  <Icon icon={Clock} size={16} />
                  <Text style={{ fontWeight: 600 }}>{t('agentCronJobs.content')}</Text>
                </Flexbox>
                <Card
                  size="small"
                  style={{ borderRadius: 12, overflow: 'hidden' }}
                  styles={{ body: { padding: 0 } }}
                >
                  {enableRichRender && <TypoBar editor={editor} />}
                  <Flexbox padding={16} style={{ minHeight: 220 }}>
                    <Editor
                      content={''}
                      editor={editor}
                      lineEmptyPlaceholder={t('agentCronJobs.form.content.placeholder')}
                      onInit={() => setEditorReady(true)}
                      onTextChange={handleContentChange}
                      placeholder={t('agentCronJobs.form.content.placeholder')}
                      plugins={
                        enableRichRender
                          ? [
                              ReactListPlugin,
                              ReactCodePlugin,
                              ReactCodemirrorPlugin,
                              ReactHRPlugin,
                              ReactLinkPlugin,
                              ReactTablePlugin,
                              ReactMathPlugin,
                            ]
                          : undefined
                      }
                      style={{ paddingBottom: 48 }}
                      type={'text'}
                      variant={'chat'}
                    />
                  </Flexbox>
                </Card>
              </Flexbox>
            </Flexbox>
          )}
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

export default CronJobDetailPage;
