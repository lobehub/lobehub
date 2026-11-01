'use client';

import type { DashboardVisibility, WidgetLevelFilter } from '@lobechat/types';
import {
  Button,
  createModal,
  Flexbox,
  Input,
  ModalFooter,
  Segmented,
  Select,
  Skeleton,
  Text,
  TextArea,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { t as translate } from 'i18next';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardListItem, DashboardSettingsPatch } from '@/services/dashboard';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import {
  type BoardScheduleChoice,
  boardSchedulePattern,
  initialBoardScheduleChoice,
  resolveBoardSchedule,
  SCHEDULE_PRESETS,
} from './utils/schedule';

const Field = ({
  children,
  hint,
  label,
}: {
  children: ReactNode;
  hint?: ReactNode;
  label: string;
}) => (
  <Flexbox gap={6}>
    <Text fontSize={13} weight={500}>
      {label}
    </Text>
    {children}
    {hint && (
      <Text fontSize={12} type={'secondary'}>
        {hint}
      </Text>
    )}
  </Flexbox>
);

type SettingsBoard = Pick<
  DashboardListItem,
  'description' | 'id' | 'title' | 'visibility' | 'workspaceId'
>;

interface DashboardSettingsFormProps {
  dashboard: SettingsBoard;
  level?: WidgetLevelFilter;
}

/**
 * A board's settings: its name and description, who in the workspace sees
 * it, and one refresh cadence for the widgets on it. Cadence lives on each
 * widget and only its creator may change it, so the board-wide choice writes
 * to the user's own widgets and says how many that is.
 */
const DashboardSettingsForm = ({ dashboard, level }: DashboardSettingsFormProps) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const { close } = useModalContext();
  const updateDashboard = useDashboardStore((s) => s.updateDashboard);
  const setWidgetsSchedule = useDashboardStore((s) => s.setWidgetsSchedule);
  const useFetchDashboardDetail = useDashboardStore((s) => s.useFetchDashboardDetail);
  const { data } = useFetchDashboardDetail(dashboard.id);
  const detail = useDashboardStore(dashboardSelectors.dashboardDetail(dashboard.id));
  const userId = useUserStore(userProfileSelectors.userId);

  const [title, setTitle] = useState(dashboard.title);
  const [description, setDescription] = useState(dashboard.description ?? '');
  const [visibility, setVisibility] = useState<DashboardVisibility>(dashboard.visibility);
  const [pickedSchedule, setPickedSchedule] = useState<BoardScheduleChoice>();
  const [saving, setSaving] = useState(false);

  // Home boards outside a workspace are personal: there is no one to share with.
  const showVisibility = !!dashboard.workspaceId;
  const widgets = (detail?.items ?? []).map(({ widget }) => widget);
  const ownWidgets = widgets.filter((widget) => !!userId && widget.userId === userId);
  const othersCount = widgets.length - ownWidgets.length;
  const scheduleState = resolveBoardSchedule(ownWidgets);
  const initialSchedule = initialBoardScheduleChoice(scheduleState);
  const schedule = pickedSchedule ?? initialSchedule;
  const trimmedTitle = title.trim();

  const scheduleOptions = [
    ...(initialSchedule === 'keep'
      ? [
          {
            label:
              scheduleState.kind === 'custom'
                ? t('settings.scheduleKeepCustom', { pattern: scheduleState.pattern })
                : t('settings.scheduleKeep'),
            value: 'keep',
          },
        ]
      : []),
    { label: t('schedule.manual'), value: 'manual' },
    ...SCHEDULE_PRESETS.map((preset) => ({
      label: t(`schedule.${preset.key}`),
      value: preset.key,
    })),
  ];

  const handleSave = async () => {
    if (!trimmedTitle || saving) return;
    setSaving(true);
    try {
      const patch: DashboardSettingsPatch = {};
      if (trimmedTitle !== dashboard.title) patch.title = trimmedTitle;
      const nextDescription = description.trim() || null;
      if (nextDescription !== (dashboard.description ?? null)) patch.description = nextDescription;
      if (showVisibility && visibility !== dashboard.visibility) patch.visibility = visibility;

      let keptPrivate = false;
      if (Object.keys(patch).length > 0) {
        const saved = await updateDashboard(dashboard.id, patch, level);
        keptPrivate = patch.visibility === 'public' && saved?.visibility === 'private';
      }

      let failed = 0;
      const pattern = boardSchedulePattern(schedule);
      if (schedule !== initialSchedule && pattern !== undefined && ownWidgets.length > 0) {
        ({ failed } = await setWidgetsSchedule(
          ownWidgets.map((widget) => widget.id),
          { pattern, timezone: pattern ? Intl.DateTimeFormat().resolvedOptions().timeZone : null },
        ));
      }

      if (failed > 0) toast.error(t('settings.scheduleFailed', { count: failed }));
      else if (keptPrivate) toast.info(t('settings.visibilityKeptPrivate'));
      else toast.success(t('settings.saved'));
      close();
    } catch (error) {
      console.error('[dashboard] settings save failed', error);
      toast.error(t('operationFailed', { ns: 'common' }));
    } finally {
      setSaving(false);
    }
  };

  const renderSchedule = () => {
    if (!data) return <Skeleton height={32} width={'100%'} />;
    if (ownWidgets.length === 0) {
      return (
        <Text fontSize={12} type={'secondary'}>
          {widgets.length === 0 ? t('settings.scheduleNoWidgets') : t('settings.scheduleNotOwner')}
        </Text>
      );
    }
    return (
      <Select
        data-dashboard-settings-schedule
        options={scheduleOptions}
        value={schedule}
        variant={'filled'}
        onChange={(value) => setPickedSchedule(value as BoardScheduleChoice)}
      />
    );
  };

  return (
    <>
      <Flexbox gap={20} padding={16}>
        <Field label={t('form.titleLabel')}>
          <Input
            autoFocus
            data-dashboard-title-input
            maxLength={200}
            placeholder={t('form.titlePlaceholder')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label={t('form.descriptionLabel')}>
          <TextArea
            autoSize={{ maxRows: 6, minRows: 2 }}
            maxLength={2000}
            placeholder={t('form.descriptionPlaceholder')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        {showVisibility && (
          <Field label={t('settings.visibility')}>
            <Segmented
              block
              value={visibility}
              options={[
                { label: t('settings.visibilityPrivate'), value: 'private' },
                { label: t('settings.visibilityPublic'), value: 'public' },
              ]}
              onChange={(value) => setVisibility(value as DashboardVisibility)}
            />
          </Field>
        )}
        <Field
          label={t('settings.schedule')}
          hint={
            data && ownWidgets.length > 0
              ? [
                  t('settings.scheduleHint', { count: ownWidgets.length }),
                  othersCount > 0 && t('settings.scheduleOthers', { count: othersCount }),
                ]
                  .filter(Boolean)
                  .join(' ')
              : undefined
          }
        >
          {renderSchedule()}
        </Field>
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          data-dashboard-settings-save
          disabled={!trimmedTitle}
          loading={saving}
          type={'primary'}
          onClick={() => void handleSave()}
        >
          {t('save', { ns: 'common' })}
        </Button>
      </ModalFooter>
    </>
  );
};

export const openDashboardSettingsModal = ({
  dashboard,
  level,
}: {
  dashboard: SettingsBoard;
  level?: WidgetLevelFilter;
}) =>
  createModal({
    content: <DashboardSettingsForm dashboard={dashboard} level={level} />,
    footer: null,
    styles: { content: { padding: 0 } },
    title: translate('settings.title', { ns: 'dashboard' }),
    width: 480,
  });
