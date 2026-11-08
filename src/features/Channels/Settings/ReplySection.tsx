import { Button, Flexbox, Select, Switch, TextArea, toast } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import type { ChannelWakeConfig } from '@/services/channel';
import { channelActions } from '@/store/channel';

import { FormCard } from './FormCard';
import { settingsStyles } from './styles';
import {
  applyWakeForm,
  toWakeForm,
  WAKE_INSTRUCTIONS_MAX_LENGTH,
  type WakeFormValues,
} from './wakeForm';

function ReplyForm({ channelId, stored }: { channelId: string; stored: ChannelWakeConfig | null }) {
  const { t } = useTranslation('channel');
  const saved = toWakeForm(stored);
  const [form, setForm] = useState(saved);
  const [saving, setSaving] = useState<keyof WakeFormValues | null>(null);
  const update = (patch: Partial<WakeFormValues>) => setForm((prev) => ({ ...prev, ...patch }));

  const paces = (['calm', 'balanced', 'active'] as const).map((value) => ({
    label: t(`settings.reply.pace.${value}`),
    value,
  }));
  // Only a strategy tuned by hand can hold it; it cannot be chosen here.
  const options =
    saved.pace === 'custom'
      ? [...paces, { label: t('settings.reply.pace.custom'), value: 'custom' as const }]
      : paces;

  /** Each card commits its own field, leaving unsaved edits in the other cards alone. */
  const save = async (field: keyof WakeFormValues) => {
    setSaving(field);
    try {
      await channelActions.updateWakeConfig(
        channelId,
        applyWakeForm(stored, { ...saved, [field]: form[field] }),
      );
      toast.success(t('settings.saved'));
    } catch (error) {
      console.error('Failed to save the Channel reply strategy', error);
      toast.error(t('settings.reply.saveFailed'));
    } finally {
      setSaving(null);
    }
  };

  const saveButton = (field: keyof WakeFormValues) => (
    <Button
      disabled={form[field] === saved[field]}
      loading={saving === field}
      type="primary"
      onClick={() => save(field)}
    >
      {t('settings.save')}
    </Button>
  );

  return (
    <Flexbox gap={24}>
      <FormCard
        action={saveButton('enabled')}
        description={t('settings.reply.description')}
        hint={t('settings.reply.enabledHint')}
        title={t('settings.reply.enabled')}
      >
        <div>
          <Switch
            aria-label={t('settings.reply.enabled')}
            checked={form.enabled}
            onChange={(enabled) => update({ enabled })}
          />
        </div>
      </FormCard>
      {saved.enabled && (
        <>
          <FormCard
            action={saveButton('pace')}
            description={t('settings.reply.paceDescription')}
            hint={t(`settings.reply.paceHint.${form.pace}`)}
            title={t('settings.reply.paceLabel')}
          >
            <div {...stylex.props(settingsStyles.field)}>
              <Select
                aria-label={t('settings.reply.paceLabel')}
                options={options}
                style={{ width: '100%' }}
                value={form.pace}
                onChange={(pace) => update({ pace: pace as WakeFormValues['pace'] })}
              />
            </div>
          </FormCard>
          <FormCard
            action={saveButton('customInstructions')}
            description={t('settings.reply.instructionsDescription')}
            title={t('settings.reply.instructions')}
            hint={t('settings.reply.instructionsLimit', {
              count: WAKE_INSTRUCTIONS_MAX_LENGTH,
            })}
          >
            <TextArea
              aria-label={t('settings.reply.instructions')}
              autoSize={{ maxRows: 8, minRows: 3 }}
              maxLength={WAKE_INSTRUCTIONS_MAX_LENGTH}
              placeholder={t('settings.reply.instructionsPlaceholder')}
              value={form.customInstructions}
              onChange={(event) => update({ customInstructions: event.target.value })}
            />
          </FormCard>
        </>
      )}
    </Flexbox>
  );
}

export function ReplySection({ channelId }: { channelId: string }) {
  const { data, error, isLoading, mutate } = channelActions.useFetchWakeConfig(channelId);

  return (
    <AsyncBoundary
      data={data}
      error={error}
      isLoading={isLoading}
      onRetry={() => {
        void mutate();
      }}
    >
      {data && (
        <ReplyForm channelId={channelId} stored={data.channel as ChannelWakeConfig | null} />
      )}
    </AsyncBoundary>
  );
}
