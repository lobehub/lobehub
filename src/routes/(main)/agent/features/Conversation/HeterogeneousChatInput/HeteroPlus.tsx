'use client';

import { cssVar, Icon, Upload } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import {
  CalendarClockIcon,
  CheckIcon,
  ChevronRight,
  FileUp,
  PlusIcon,
  TargetIcon,
  TypeIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type ActionDropdownMenuItems } from '@/features/ChatInput/ActionBar/components/ActionDropdown';
import { ChatInputAction } from '@/features/ChatInput/ActionBar/components/ChatInputAction';
import { insertGoalTag } from '@/features/ChatInput/InputEditor/ActionTag/goalTag';
import { useChatInputStore } from '@/features/ChatInput/store';
import { useConversationStore } from '@/features/Conversation';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { OFFSETS_IN_HOURS, resolveScheduleTime } from './scheduleTime';
import { useHeteroUpload } from './useHeteroUpload';

const styles = stylex.create({
  // Stretch the Upload trigger over the whole menu row, so clicking anywhere on
  // it opens the file picker — same as the agent Plus.
  hotArea: {
    '::before': {
      backgroundColor: 'transparent',
      content: "''",
      insetBlock: 0,
      insetInline: 0,
      position: 'absolute',
    },
  },
});

/**
 * The hetero action bar's `+` menu.
 *
 * Mirrors the agent composer's Plus, but carries only what a heterogeneous run
 * actually has: file/image upload, the formatting-toolbar toggle and "Send
 * later". The agent Plus is not reused — most of it (web search, skills,
 * knowledge base, gateway mode) has no meaning for a CLI agent, and a menu of
 * mostly-inapplicable rows is worse than a small one.
 *
 * Picking a time here only *arms* the send (`scheduledSendAt`); it creates
 * nothing. The send button remains the single commit action, and the armed state
 * is shown next to it by `ScheduledSendChip`.
 */
interface HeteroPlusProps {
  /** The agent's CLI adapter type — decides whether picked images are accepted. */
  providerType?: string;
}

const HeteroPlus = memo<HeteroPlusProps>(({ providerType }) => {
  const { t } = useTranslation('chat');
  const { t: tEditor } = useTranslation('editor');
  const [open, setOpen] = useState(false);

  const [editor, showTypoBar, setShowTypoBar] = useChatInputStore((s) => [
    s.editor,
    s.showTypoBar,
    s.setShowTypoBar,
  ]);

  const scheduledSendAt = useConversationStore((s) => s.scheduledSendAt);
  const setScheduledSendAt = useConversationStore((s) => s.setScheduledSendAt);
  const enableGoals = useUserStore(labPreferSelectors.enableGoals);

  const closeMenu = useCallback(() => setOpen(false), []);
  const { beforeUpload, onFiles } = useHeteroUpload(providerType, closeMenu);

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
        closeOnClick: false,
        icon: FileUp,
        key: 'upload-file-or-image',
        label: (
          <Upload multiple beforeUpload={beforeUpload} onFiles={onFiles}>
            <div {...stylex.props(styles.hotArea)}>{t('upload.action.fileOrImageUpload')}</div>
          </Upload>
        ),
      },
      { type: 'divider' },
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
      // Goal creation shares the standard input's goal chip.
      ...(enableGoals
        ? ([
            { type: 'divider' },
            {
              icon: TargetIcon,
              key: 'set-topic-goal',
              // Same string as the chip it inserts — see the agent composer's Plus.
              label: tEditor('slash.goal'),
              onClick: () => {
                setOpen(false);
                insertGoalTag(editor, tEditor('slash.goal'));
              },
            },
          ] as ActionDropdownMenuItems)
        : []),
    ];
  }, [
    t,
    tEditor,
    showTypoBar,
    setShowTypoBar,
    armSchedule,
    scheduledSendAt,
    enableGoals,
    editor,
    beforeUpload,
    onFiles,
  ]);

  return (
    <ChatInputAction
      icon={PlusIcon}
      open={open}
      size={{ blockSize: 32, borderRadius: 16, size: 18 }}
      // Not the agent Plus's tooltip — it promises skills / context, which this
      // menu does not have.
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
