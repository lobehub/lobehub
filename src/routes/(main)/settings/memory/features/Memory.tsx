'use client';

import { type UserMemoryEffort } from '@lobechat/types';
import { type FormGroupItemType } from '@lobehub/ui';
import { Flexbox, Form, Skeleton, Tooltip } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { FORM_STYLE } from '@/const/layoutTokens';
import LevelSlider from '@/features/ModelSwitchPanel/components/ControlsForm/LevelSlider';
import { usePermission } from '@/hooks/usePermission';
import { useSaveState } from '@/hooks/useSaveState';
import { localeOptions } from '@/locales/resources';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

const MEMORY_EFFORT_LEVELS: readonly UserMemoryEffort[] = ['low', 'medium', 'high'];

const MemorySetting = memo(() => {
  const { t } = useTranslation('setting');
  const { allowed: canManageMemory, reason } = usePermission('manage_settings');
  const [form] = Form.useForm();
  const { memory } = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();

  if (!isUserStateInit) return <Skeleton active paragraph={{ rows: 3 }} title={false} />;

  const memorySettings: FormGroupItemType = {
    children: [
      {
        children: (
          <Tooltip title={reason}>
            <Switch disabled={!canManageMemory} />
          </Tooltip>
        ),
        desc: t('memory.enabled.desc'),
        label: t('memory.enabled.title'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'enabled',
        valuePropName: 'checked',
      },
      {
        children: (
          <Tooltip title={reason}>
            <LevelSlider<UserMemoryEffort>
              defaultValue="medium"
              disabled={!canManageMemory}
              levels={MEMORY_EFFORT_LEVELS}
              style={{ minWidth: 160 }}
              value={memory?.effort ?? 'medium'}
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
      {
        children: (
          <Tooltip title={reason}>
            <Flexbox horizontal justify={'flex-end'}>
              <Select
                allowClear
                disabled={!canManageMemory}
                placeholder={t('memory.preferredLanguage.placeholder')}
                style={{ maxWidth: '100%', minWidth: 220, width: 'min(260px, 100%)' }}
                value={memory?.preferredLanguage || undefined}
                options={[
                  { label: t('memory.preferredLanguage.auto'), value: 'auto' },
                  ...localeOptions,
                ]}
                onChange={(value) => {
                  if (!canManageMemory) return;

                  save(() => setSettings({ memory: { preferredLanguage: value ?? '' } }));
                }}
              />
            </Flexbox>
          </Tooltip>
        ),
        desc: t('memory.preferredLanguage.desc'),
        label: t('memory.preferredLanguage.title'),
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
      initialValues={memory}
      items={[memorySettings]}
      itemsType={'group'}
      variant={'filled'}
      onValuesChange={(values) => {
        if (!canManageMemory) return;

        save(() => setSettings({ memory: values }));
      }}
      {...FORM_STYLE}
    />
  );
});

export default MemorySetting;
