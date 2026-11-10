import type { MeetingActionItem } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  Checkbox,
  DayjsDatePicker,
  Flexbox,
  Select,
  type SelectOptions,
  Tag,
  Text,
  TextArea,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { BotIcon, Undo2Icon, UserIcon, XIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InstantSwitch from '@/components/InstantSwitch';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';
import { type CreateMeetingTaskItem, meetingService } from '@/services/meeting';
import { meetingActions } from '@/store/meeting';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import { buildActionItemDrafts, type DraftMap, selectedTaskItems } from './actionItemDrafts';
import { taskCreationCounts } from './normalize';

const styles = stylex.create({
  item: {
    paddingBlockStart: { 'default': 12, ':first-child': 0 },
    paddingBlockEnd: 12,
    borderBlockStartWidth: { 'default': 1, ':first-child': 0 },
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  link: {
    cursor: 'pointer',
    paddingBlock: 0,
    paddingInline: 0,
    borderStyle: 'none',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    fontSize: 12,
    color: cssVar.colorPrimary,
  },
});

const ASSIGNEE_CANDIDATES_KEY = 'meeting-assignee-candidates';

interface ActionItemsProps {
  items: MeetingActionItem[];
  meetingId: string;
  /** Jump-to-source button for one item, rendered by the parent that owns playback. */
  renderCitation: (item: MeetingActionItem) => React.ReactNode;
  /** Shown name of each diarization label, so an owner named "S3" reads as that speaker. */
  speakerNameByLabel: Map<string, string>;
}

/**
 * Action items of the minutes as an editable confirmation list: each
 * suggestion can be ticked, reworded, assigned to a member or agent and
 * given a deadline before it becomes a task. Created items link to their
 * task; dismissed ones can be restored.
 */
const ActionItems = ({
  items,
  meetingId,
  renderCitation,
  speakerNameByLabel,
}: ActionItemsProps) => {
  const { t } = useTranslation('meeting');
  const navigate = useWorkspaceAwareNavigate();
  const [drafts, setDrafts] = useState<DraftMap>(() => buildActionItemDrafts(items));
  const [creating, setCreating] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const autoCreate = useUserStore(preferenceSelectors.autoCreateMeetingTasks);
  const updatePreference = useUserStore((s) => s.updatePreference);

  // New suggestions (a regeneration) get a draft; edits to existing ones are kept.
  const itemKey = items
    .map((item) => `${item.id}:${item.status}:${item.assignee?.id ?? ''}`)
    .join('|');
  const [draftKey, setDraftKey] = useState(itemKey);
  if (draftKey !== itemKey) {
    setDraftKey(itemKey);
    setDrafts((current) => buildActionItemDrafts(items, current));
  }

  const { data: candidates = [] } = useClientDataSWR(
    ASSIGNEE_CANDIDATES_KEY,
    meetingService.assigneeCandidates,
  );

  const assigneeOptions = useMemo<SelectOptions>(() => {
    const members = candidates.filter((candidate) => candidate.type === 'user');
    const agents = candidates.filter((candidate) => candidate.type === 'agent');
    const toOption = (candidate: (typeof candidates)[number]) => ({
      label: candidate.name,
      value: `${candidate.type}:${candidate.id}`,
    });
    return [
      ...(members.length > 0
        ? [{ label: t('actionItem.assigneeGroup.members'), options: members.map(toOption) }]
        : []),
      ...(agents.length > 0
        ? [{ label: t('actionItem.assigneeGroup.agents'), options: agents.map(toOption) }]
        : []),
    ];
  }, [candidates, t]);

  const suggested = items.filter((item) => item.status === 'suggested');
  const created = items.filter((item) => item.status === 'created');
  const dismissed = items.filter((item) => item.status === 'dismissed');
  const toCreate: CreateMeetingTaskItem[] = selectedTaskItems(suggested, drafts);

  const patchDraft = (id: string, patch: Partial<DraftMap[string]>) =>
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  const setStatus = async (item: MeetingActionItem, status: MeetingActionItem['status']) => {
    try {
      await meetingService.saveActionItems(
        meetingId,
        items.map((current) => (current.id === item.id ? { ...current, status } : current)),
      );
      await meetingActions.refreshMeetingDetail(meetingId);
    } catch {
      toast.error(t('actionItem.saveFailed'));
    }
  };

  const createTasks = async () => {
    if (toCreate.length === 0) return;
    setCreating(true);
    try {
      const { created, failed } = taskCreationCounts(
        await meetingService.createTasks(meetingId, toCreate),
      );
      if (created > 0) toast.success(t('actionItem.createSuccess', { count: created }));
      if (failed > 0) toast.error(t('actionItem.createPartialFailed', { count: failed }));
      await meetingActions.refreshMeetingDetail(meetingId);
    } catch {
      toast.error(t('actionItem.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Text fontSize={12} type={'secondary'}>
          {t('actionItem.autoCreate')}
        </Text>
        <InstantSwitch
          enabled={autoCreate}
          size={'small'}
          onChange={(enabled) => updatePreference({ meeting: { autoCreateTasks: enabled } })}
        />
      </Flexbox>

      {items.length === 0 && <Text type={'secondary'}>{t('minutes.empty')}</Text>}

      {suggested.length > 0 && (
        <Flexbox data-testid={'meeting-action-items-confirm'} gap={0}>
          {suggested.map((item) => {
            const draft = drafts[item.id];
            if (!draft) return null;
            const assigneeValue = draft.assignee
              ? `${draft.assignee.type}:${draft.assignee.id}`
              : undefined;

            return (
              <Flexbox className={stylex.props(styles.item).className} gap={8} key={item.id}>
                <Flexbox horizontal align={'flex-start'} gap={8}>
                  <Checkbox
                    aria-label={t('actionItem.select')}
                    checked={draft.checked}
                    style={{ marginBlockStart: 6 }}
                    onChange={(checked) => patchDraft(item.id, { checked })}
                  />
                  <TextArea
                    aria-label={t('actionItem.text')}
                    autoSize={{ maxRows: 4, minRows: 1 }}
                    style={{ flex: 1, paddingInline: 0, resize: 'none' }}
                    value={draft.text}
                    variant={'borderless'}
                    onChange={(event) => patchDraft(item.id, { text: event.target.value })}
                  />
                  <ActionIcon
                    icon={XIcon}
                    size={'small'}
                    title={t('actionItem.dismiss')}
                    onClick={() => void setStatus(item, 'dismissed')}
                  />
                </Flexbox>
                <Flexbox horizontal align={'center'} gap={8} style={{ paddingInlineStart: 24 }}>
                  <Select
                    allowClear
                    showSearch
                    options={assigneeOptions}
                    placeholder={t('actionItem.assigneePlaceholder')}
                    size={'small'}
                    style={{ flex: 1, minWidth: 0 }}
                    value={assigneeValue}
                    onChange={(value) => {
                      if (typeof value !== 'string') return patchDraft(item.id, { assignee: null });
                      const [type, ...rest] = value.split(':');
                      patchDraft(item.id, {
                        assignee: { id: rest.join(':'), type: type as 'agent' | 'user' },
                      });
                    }}
                  />
                  <DayjsDatePicker
                    placeholder={t('actionItem.duePlaceholder')}
                    size={'small'}
                    style={{ width: 132 }}
                    value={draft.dueDate ? dayjs(draft.dueDate) : null}
                    onChange={(date) =>
                      patchDraft(item.id, {
                        dueDate: date ? dayjs(date).format('YYYY-MM-DD') : null,
                      })
                    }
                  />
                </Flexbox>
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={12}
                  style={{ paddingInlineStart: 24 }}
                  wrap={'wrap'}
                >
                  {item.assigneeHint && !draft.assignee && (
                    <Text fontSize={12} type={'secondary'}>
                      {t('actionItem.mentioned', {
                        name: speakerNameByLabel.get(item.assigneeHint) ?? item.assigneeHint,
                      })}
                    </Text>
                  )}
                  {renderCitation(item)}
                </Flexbox>
              </Flexbox>
            );
          })}
          <Button
            block
            disabled={toCreate.length === 0}
            loading={creating}
            style={{ marginBlockStart: 12 }}
            type={'primary'}
            onClick={() => void createTasks()}
          >
            {t('actionItem.create', { count: toCreate.length })}
          </Button>
        </Flexbox>
      )}

      {created.length > 0 && (
        <Flexbox data-testid={'meeting-action-items-created'} gap={0}>
          {created.map((item) => (
            <Flexbox className={stylex.props(styles.item).className} gap={6} key={item.id}>
              <Flexbox horizontal align={'flex-start'} gap={8} justify={'space-between'}>
                <Text style={{ minWidth: 0 }}>{item.text}</Text>
                <Tag color={'success'} size={'small'}>
                  {t('actionItem.status.created')}
                </Tag>
              </Flexbox>
              <Flexbox horizontal align={'center'} gap={12} wrap={'wrap'}>
                {item.assignee && (
                  <Flexbox horizontal align={'center'} gap={4}>
                    {item.assignee.type === 'agent' ? (
                      <BotIcon size={12} />
                    ) : (
                      <UserIcon size={12} />
                    )}
                    <Text fontSize={12} type={'secondary'}>
                      {item.assignee.name}
                    </Text>
                  </Flexbox>
                )}
                {item.dueDate && (
                  <Text fontSize={12} type={'secondary'}>
                    {t('actionItem.due', { date: item.dueDate })}
                  </Text>
                )}
                {renderCitation(item)}
                {item.taskId && (
                  <button
                    className={stylex.props(styles.link).className}
                    type={'button'}
                    onClick={() => navigate(`/task/${item.taskIdentifier ?? item.taskId}`)}
                  >
                    {item.taskIdentifier
                      ? t('actionItem.openTaskWithId', { id: item.taskIdentifier })
                      : t('actionItem.openTask')}
                  </button>
                )}
              </Flexbox>
            </Flexbox>
          ))}
        </Flexbox>
      )}

      {dismissed.length > 0 && (
        <Flexbox gap={6}>
          <button
            className={stylex.props(styles.link).className}
            type={'button'}
            onClick={() => setShowDismissed((v) => !v)}
          >
            {showDismissed
              ? t('actionItem.hideDismissed')
              : t('actionItem.showDismissed', { count: dismissed.length })}
          </button>
          {showDismissed &&
            dismissed.map((item) => (
              <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} key={item.id}>
                <Text delete style={{ minWidth: 0 }} type={'secondary'}>
                  {item.text}
                </Text>
                <ActionIcon
                  icon={Undo2Icon}
                  size={'small'}
                  title={t('actionItem.restore')}
                  onClick={() => void setStatus(item, 'suggested')}
                />
              </Flexbox>
            ))}
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default ActionItems;
