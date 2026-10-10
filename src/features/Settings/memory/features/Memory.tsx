'use client';

import { type UserMemoryEffort, type UserMemorySettings } from '@lobechat/types';
import { Flexbox, Icon, Skeleton, Switch, Tooltip } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import { CircleHelpIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { FORM_STYLE } from '@/const/layoutTokens';
import LevelSlider from '@/features/ModelSwitchPanel/components/ControlsForm/LevelSlider';
import { usePermission } from '@/hooks/usePermission';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

const MEMORY_EFFORT_LEVELS: readonly UserMemoryEffort[] = ['low', 'medium', 'high'];

const MemorySetting = memo(() => {
  const { t } = useTranslation('setting');
  const { allowed: canManageMemory, reason } = usePermission('manage_settings');
  const memory = useUserStore(settingsSelectors.currentMemorySettings, isEqual);
  const memoryEnabled = useUserStore(settingsSelectors.memoryEnabled);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();
  const memoryValues: UserMemorySettings = { ...memory, enabled: memoryEnabled };
  const form = useForm({
    initialValues: memoryValues,
    values: memoryValues,
    onValuesChange: (values) => {
      if (!canManageMemory) return;

      save(() => setSettings({ memory: values }));
    },
  });

  if (!isUserStateInit) return <Skeleton.Text rows={3} />;

  const memorySettings: FormGroupItem<UserMemorySettings> = {
    children: [
      {
        children: <Switch disabled={!canManageMemory} />,
        desc: t('memory.enabled.desc'),
        label: (
          <Flexbox horizontal align={'center'} gap={4}>
            {t('memory.enabled.title')}
            {reason && (
              <Tooltip title={reason}>
                <Icon icon={CircleHelpIcon} size={14} style={{ cursor: 'help' }} />
              </Tooltip>
            )}
          </Flexbox>
        ),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enabled',
      },
      {
        children: (
          <Tooltip title={reason}>
            <LevelSlider<UserMemoryEffort>
              defaultValue="medium"
              disabled={!canManageMemory}
              levels={MEMORY_EFFORT_LEVELS}
              style={{ minWidth: 160 }}
              value={memory.effort}
              marks={{
                0: t('memory.effort.level.low'),
                1: t('memory.effort.level.medium'),
                2: t('memory.effort.level.high'),
              }}
              onChange={(value) => {
                if (!canManageMemory) return;

                save(() => setSettings({ memory: { effort: value } }));
              }}
            />
          </Tooltip>
        ),
        desc: t('memory.effort.desc'),
        label: t('memory.effort.title'),
        layout: 'horizontal',
        minWidth: undefined,
      },
    ],
    extra: <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />,
    title: t('memory.title'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      items={[memorySettings]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default MemorySetting;
