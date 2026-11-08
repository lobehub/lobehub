import { Button, Flexbox, Select, Switch, Text, TextArea, toast } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import type { ChannelWakeConfig } from '@/services/channel';
import { channelActions } from '@/store/channel';

import { Section } from './Section';
import {
  applyWakeForm,
  toWakeForm,
  WAKE_INSTRUCTIONS_MAX_LENGTH,
  type WakeFormValues,
} from './wakeForm';

function ReplyForm({ channelId, stored }: { channelId: string; stored: ChannelWakeConfig | null }) {
  const { t } = useTranslation('channel');
  const [form, setForm] = useState(() => toWakeForm(stored));
  const [saving, setSaving] = useState(false);
  const update = (patch: Partial<WakeFormValues>) => setForm((prev) => ({ ...prev, ...patch }));

  const paces = (['calm', 'balanced', 'active'] as const).map((value) => ({
    label: t(`settings.reply.pace.${value}`),
    value,
  }));
  // Only a strategy tuned by hand can hold it; it cannot be chosen here.
  const options =
    toWakeForm(stored).pace === 'custom'
      ? [...paces, { label: t('settings.reply.pace.custom'), value: 'custom' as const }]
      : paces;

  const save = async () => {
    setSaving(true);
    try {
      await channelActions.updateWakeConfig(channelId, applyWakeForm(stored, form));
      toast.success(t('settings.saved'));
    } catch (error) {
      console.error('Failed to save the Channel reply strategy', error);
      toast.error(t('settings.reply.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align="center" gap={16} justify="space-between">
        <Flexbox gap={2}>
          <Text weight={500}>{t('settings.reply.enabled')}</Text>
          <Text fontSize={12} type="secondary">
            {t('settings.reply.enabledHint')}
          </Text>
        </Flexbox>
        <Switch
          aria-label={t('settings.reply.enabled')}
          checked={form.enabled}
          onChange={(enabled) => update({ enabled })}
        />
      </Flexbox>
      {form.enabled && (
        <>
          <Flexbox gap={6}>
            <Text weight={500}>{t('settings.reply.paceLabel')}</Text>
            <Select
              aria-label={t('settings.reply.paceLabel')}
              options={options}
              value={form.pace}
              onChange={(pace) => update({ pace: pace as WakeFormValues['pace'] })}
            />
            <Text fontSize={12} type="secondary">
              {t(`settings.reply.paceHint.${form.pace}`)}
            </Text>
          </Flexbox>
          <Flexbox gap={6}>
            <Text weight={500}>{t('settings.reply.instructions')}</Text>
            <TextArea
              aria-label={t('settings.reply.instructions')}
              autoSize={{ maxRows: 8, minRows: 3 }}
              maxLength={WAKE_INSTRUCTIONS_MAX_LENGTH}
              placeholder={t('settings.reply.instructionsPlaceholder')}
              value={form.customInstructions}
              onChange={(event) => update({ customInstructions: event.target.value })}
            />
          </Flexbox>
        </>
      )}
      <Flexbox horizontal justify="flex-end">
        <Button
          disabled={isEqual(form, toWakeForm(stored))}
          loading={saving}
          type="primary"
          onClick={save}
        >
          {t('settings.save')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

export function ReplySection({ channelId }: { channelId: string }) {
  const { t } = useTranslation('channel');
  const { data, error, isLoading, mutate } = channelActions.useFetchWakeConfig(channelId);

  return (
    <Section description={t('settings.reply.description')} title={t('settings.reply.title')}>
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
    </Section>
  );
}
