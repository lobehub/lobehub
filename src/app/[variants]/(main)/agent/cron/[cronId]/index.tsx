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
import type { UpdateAgentCronJobData } from '@/database/schemas/agentCronJob';
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

import {
  SCHEDULE_TYPE_OPTIONS,
  type ScheduleType,
  TIMEZONE_OPTIONS,
  WEEKDAY_LABELS,
  WEEKDAY_OPTIONS,
  buildCronPattern,
  parseCronPattern,
} from './CronConfig';

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

  const summaryTags = useMemo(() => {
    if (!draft) return [];

    const tags: Array<{ key: string; label: string }> = [];

    // Schedule type
    const scheduleTypeLabel = SCHEDULE_TYPE_OPTIONS.find(
      (opt) => opt.value === draft.scheduleType,
    )?.label;
    if (scheduleTypeLabel) {
      tags.push({
        key: 'scheduleType',
        label: t(scheduleTypeLabel as any),
      });
    }

    // Trigger time
    if (draft.scheduleType === 'hourly') {
      tags.push({
        key: 'interval',
        label: `Every ${draft.hourlyInterval || 1} hour(s)`,
      });
    } else {
      tags.push({
        key: 'triggerTime',
        label: draft.triggerTime.format('HH:mm'),
      });
    }

    // Timezone
    tags.push({
      key: 'timezone',
      label: draft.timezone,
    });

    // Weekdays for weekly schedule
    if (draft.scheduleType === 'weekly' && draft.weekdays.length > 0) {
      tags.push({
        key: 'weekdays',
        label: draft.weekdays.map((day) => WEEKDAY_LABELS[day]).join(', '),
      });
    }

    return tags;
  }, [draft, t]);

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
  }, [cronJob, editor, editorReady, enableRichRender, flushPendingSave]);

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

                  {/* Schedule Configuration - All in one row */}
                  <Flexbox align="center" gap={8} horizontal style={{ flexWrap: 'wrap' }}>
                    <Tag variant={'borderless'}>{t('agentCronJobs.schedule')}</Tag>
                    <Select
                      onChange={(value: ScheduleType) =>
                        updateDraft({
                          scheduleType: value,
                          weekdays: value === 'weekly' ? [0, 1, 2, 3, 4, 5, 6] : [],
                        })
                      }
                      options={SCHEDULE_TYPE_OPTIONS.map((opt) => ({
                        label: t(opt.label as any),
                        value: opt.value,
                      }))}
                      size="small"
                      style={{ minWidth: 120 }}
                      value={draft?.scheduleType ?? 'daily'}
                    />

                    {/* Trigger Time - show for daily and weekly */}
                    {draft?.scheduleType !== 'hourly' && (
                      <>
                        <Tag variant={'borderless'}>Trigger Time</Tag>
                        <TimePicker
                          format="HH:mm"
                          onChange={(value) => {
                            if (value) updateDraft({ triggerTime: value });
                          }}
                          size="small"
                          style={{ minWidth: 120 }}
                          value={draft?.triggerTime ?? dayjs().hour(0).minute(0)}
                        />
                      </>
                    )}

                    {/* Hourly Interval - show only for hourly */}
                    {draft?.scheduleType === 'hourly' && (
                      <>
                        <Tag variant={'borderless'}>Every</Tag>
                        <InputNumber
                          max={24}
                          min={1}
                          onChange={(value) => updateDraft({ hourlyInterval: value ?? 1 })}
                          size="small"
                          style={{ width: 80 }}
                          value={draft?.hourlyInterval ?? 1}
                        />
                        <Text type="secondary">hour(s)</Text>
                      </>
                    )}

                    {/* Timezone */}
                    <Tag variant={'borderless'}>Timezone</Tag>
                    <Select
                      onChange={(value: string) => updateDraft({ timezone: value })}
                      options={TIMEZONE_OPTIONS}
                      showSearch
                      size="small"
                      style={{ maxWidth: 300, minWidth: 200 }}
                      value={draft?.timezone ?? 'UTC'}
                    />

                    {/* Weekdays - show only for weekly */}
                    {draft?.scheduleType === 'weekly' && (
                      <>
                        <Tag variant={'borderless'}>Days</Tag>
                        <Checkbox.Group
                          onChange={(values: number[]) => updateDraft({ weekdays: values })}
                          options={WEEKDAY_OPTIONS}
                          style={{ display: 'flex', flexWrap: 'nowrap', gap: 8 }}
                          value={draft?.weekdays ?? [0, 1, 2, 3, 4, 5, 6]}
                        />
                      </>
                    )}
                  </Flexbox>

                  {/* Max Executions */}
                  <Flexbox align="center" gap={8} horizontal style={{ flexWrap: 'wrap' }}>
                    <Tag variant={'borderless'}>{t('agentCronJobs.maxExecutions')}</Tag>
                    <InputNumber
                      min={1}
                      onChange={(value: number | null) =>
                        updateDraft({ maxExecutions: value ?? null })
                      }
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
