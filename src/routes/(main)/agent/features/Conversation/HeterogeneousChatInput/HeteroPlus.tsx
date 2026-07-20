'use client';

import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import {
  CalendarClockIcon,
  CheckIcon,
  ChevronRight,
  PlusIcon,
  TargetIcon,
  TypeIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import Action from '@/features/ChatInput/ActionBar/components/Action';
import { type ActionDropdownMenuItems } from '@/features/ChatInput/ActionBar/components/ActionDropdown';
import { useChatInputStore } from '@/features/ChatInput/store';
import { useConversationStore } from '@/features/Conversation';
import { useGoalArmStore } from '@/features/Conversation/ChatInput/VerifyTray/goalArmStore';
import { openTopicGoalModal } from '@/features/Conversation/ChatInput/VerifyTray/useTopicChecklist';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { OFFSETS_IN_HOURS, resolveScheduleTime } from './scheduleTime';

/**
 * The hetero action bar's `+` menu.
 *
 * Mirrors the agent composer's Plus, but carries only what a heterogeneous run
 * actually has: the formatting-toolbar toggle and "Send later". The agent Plus
 * is not reused — most of it (attachments, web search, skills, gateway mode) has
 * no meaning for a CLI agent, and a menu of mostly-inapplicable rows is worse
 * than a small one.
 *
 * Picking a time here only *arms* the send (`scheduledSendAt`); it creates
 * nothing. The send button remains the single commit action, and the armed state
 * is shown next to it by `ScheduledSendChip`.
 */
const HeteroPlus = memo(() => {
  const { t } = useTranslation('chat');
  const { t: tEditor } = useTranslation('editor');
  const { t: tVerify } = useTranslation('verify');
  const [open, setOpen] = useState(false);

  const [showTypoBar, setShowTypoBar] = useChatInputStore((s) => [s.showTypoBar, s.setShowTypoBar]);

  const scheduledSendAt = useConversationStore((s) => s.scheduledSendAt);
  const setScheduledSendAt = useConversationStore((s) => s.setScheduledSendAt);
  const topicId = useConversationStore((s) => s.context.topicId);
  const agentId = useConversationStore((s) => s.context.agentId);
  const enableTopicAcceptance = useUserStore(labPreferSelectors.enableTopicAcceptance);

  const armSchedule = useCallback(
    (hours: number) => {
      setScheduledSendAt(resolveScheduleTime(hours).toISOString());
      setOpen(false);
    },
    [setScheduledSendAt],
  );

  const items: ActionDropdownMenuItems = useMemo(() => {
    // Which row is armed: compare against the same on-the-hour slot each row
    // would produce, so the check mark tracks the row the user actually picked.
    const armedHours = scheduledSendAt
      ? OFFSETS_IN_HOURS.find((hours) =>
          resolveScheduleTime(hours).isSame(dayjs(scheduledSendAt), 'minute'),
        )
      : undefined;

    return [
      {
        children: OFFSETS_IN_HOURS.map((hours) => ({
          extra:
            armedHours === hours ? (
              <Icon icon={CheckIcon} size={16} style={{ color: cssVar.colorSuccess }} />
            ) : (
              <span style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>
                {resolveScheduleTime(hours).format('MM-DD HH:mm')}
              </span>
            ),
          key: `scheduleSend-${hours}h`,
          label: t('input.schedule.inHours', { count: hours }),
          onClick: () => armSchedule(hours),
        })),
        // Trailing chevron (replaces base-ui's default triangle submenu arrow,
        // which ActionDropdown hides via the .lobe-submenu-chevron rule).
        extra: <Icon className="lobe-submenu-chevron" icon={ChevronRight} size={16} />,
        icon: CalendarClockIcon,
        key: 'scheduleSend',
        label: t('input.schedule.title'),
      },
      { type: 'divider' },
      // Formatting toolbar toggle — same trailing-switch row as the agent Plus.
      {
        checked: Boolean(showTypoBar),
        icon: TypeIcon,
        key: 'typo',
        label: tEditor('actions.typobar.title'),
        onCheckedChange: (checked: boolean) => setShowTypoBar(checked),
        type: 'switch',
      },
      // Topic goal (lab): before a topic exists this *arms* the goal (the next
      // message becomes it); once a topic exists it opens the editor directly.
      ...(enableTopicAcceptance
        ? ([
            { type: 'divider' },
            {
              icon: TargetIcon,
              key: 'set-topic-goal',
              label: tVerify('acceptance.tray.menuSetGoal'),
              onClick: () => {
                setOpen(false);
                if (topicId) {
                  void openTopicGoalModal(topicId);
                } else if (agentId) {
                  useGoalArmStore.getState().arm(agentId);
                  message.success(tVerify('acceptance.tray.goalArmed'));
                }
              },
            },
          ] as ActionDropdownMenuItems)
        : []),
    ];
  }, [
    t,
    tEditor,
    tVerify,
    showTypoBar,
    setShowTypoBar,
    armSchedule,
    scheduledSendAt,
    enableTopicAcceptance,
    agentId,
    topicId,
  ]);

  return (
    <Action
      icon={PlusIcon}
      open={open}
      size={{ blockSize: 32, borderRadius: 16, size: 18 }}
      // Not the agent Plus's tooltip — it promises files / skills / context, none
      // of which this menu has.
      title={t('input.heteroPlus.tooltip')}
      tooltipProps={{ placement: 'top' }}
      dropdown={{
        menu: { items },
        minWidth: 220,
        placement: 'topLeft',
      }}
      onOpenChange={setOpen}
    />
  );
});

HeteroPlus.displayName = 'HeteroPlus';

export default HeteroPlus;
