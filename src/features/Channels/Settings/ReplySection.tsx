import { Flexbox, Switch, Text, TextArea, toast } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { ChoiceList } from '@/features/AgentChannel/PlatformDetail/ChoiceList';
import { ModuleSaveBar } from '@/features/AgentChannel/PlatformDetail/ModuleSaveBar';
import type { ChannelWakeConfig } from '@/services/channel';
import { channelActions } from '@/store/channel';

import { applyWakeForm, toWakeForm, WAKE_TEXT_MAX_LENGTH, type WakeFormValues } from './wakeForm';

/** The blocks with a Save of their own, as on an IM bot's reply settings. */
const MODULES = {
  judgement: ['duties', 'customInstructionsEnabled', 'customInstructions'],
  pace: ['pace'],
} satisfies Record<string, (keyof WakeFormValues)[]>;
type ModuleId = keyof typeof MODULES;

const Field = ({
  children,
  desc,
  horizontal,
  label,
}: {
  children: ReactNode;
  desc?: string;
  horizontal?: boolean;
  label: string;
}) => (
  <Flexbox
    align={horizontal ? 'center' : undefined}
    gap={horizontal ? 16 : 8}
    horizontal={horizontal}
    justify={horizontal ? 'space-between' : undefined}
    paddingBlock={12}
  >
    <Flexbox gap={2}>
      <Text weight={500}>{label}</Text>
      {desc && (
        <Text fontSize={12} type="secondary">
          {desc}
        </Text>
      )}
    </Flexbox>
    {children}
  </Flexbox>
);

function ReplyForm({ channelId, stored }: { channelId: string; stored: ChannelWakeConfig | null }) {
  const { t } = useTranslation(['channel', 'agent']);
  const saved = toWakeForm(stored);
  const [form, setForm] = useState(saved);
  const [saving, setSaving] = useState<ModuleId | null>(null);
  const update = (patch: Partial<WakeFormValues>) => setForm((prev) => ({ ...prev, ...patch }));

  const write = (values: WakeFormValues) =>
    channelActions.updateWakeConfig(channelId, applyWakeForm(stored, values));
  const reportFailure = (error: unknown) => {
    console.error('Failed to save the Channel reply strategy', error);
    toast.error(t('settings.reply.saveFailed'));
  };

  /** The switch saves as it changes; every other block is committed by its own Save. */
  const toggle = async (enabled: boolean) => {
    update({ enabled });
    try {
      await write({ ...saved, enabled });
    } catch (error) {
      update({ enabled: saved.enabled });
      reportFailure(error);
    }
  };

  const pick = (id: ModuleId, source: WakeFormValues) =>
    Object.fromEntries(MODULES[id].map((key) => [key, source[key]])) as Partial<WakeFormValues>;
  const saveBar = (id: ModuleId) => (
    <ModuleSaveBar
      dirty={MODULES[id].some((key) => form[key] !== saved[key])}
      saving={saving === id}
      onDiscard={() => update(pick(id, saved))}
      onSave={async () => {
        setSaving(id);
        try {
          await write({ ...saved, ...pick(id, form) });
          toast.success(t('settings.saved'));
        } catch (error) {
          reportFailure(error);
        } finally {
          setSaving(null);
        }
      }}
    />
  );

  const paces = (['calm', 'balanced', 'active'] as const).map((value) => ({
    desc: t(`settings.reply.paceHint.${value}`),
    label: t(`settings.reply.pace.${value}`),
    recommendedLabel:
      value === 'balanced' ? t('channel.access.recommended', { ns: 'agent' }) : undefined,
    value,
  }));
  // Only a strategy tuned by hand can hold it; its numbers are not edited here.
  const options =
    saved.pace === 'custom'
      ? [
          ...paces,
          {
            desc: t('settings.reply.paceHint.custom'),
            label: t('settings.reply.pace.custom'),
            recommendedLabel: undefined,
            value: 'custom' as const,
          },
        ]
      : paces;

  return (
    <Flexbox gap={24}>
      <Text fontSize={12} type="secondary">
        {t('settings.reply.intro')}
      </Text>
      <Form.Group
        collapsible={false}
        keyValue="channel-reply-switch"
        title={t('settings.reply.section.switch')}
        variant="filled"
      >
        <Field
          horizontal
          desc={t('settings.reply.enabledHint')}
          label={t('settings.reply.enabled')}
        >
          <Switch
            aria-label={t('settings.reply.enabled')}
            checked={form.enabled}
            onChange={toggle}
          />
        </Field>
      </Form.Group>
      {form.enabled && (
        <>
          <Form.Group
            collapsible={false}
            desc={t('settings.reply.section.paceDesc')}
            extra={saveBar('pace')}
            keyValue="channel-reply-pace"
            title={t('settings.reply.section.pace')}
            variant="filled"
          >
            <Flexbox paddingBlock={8}>
              <ChoiceList
                aria-label={t('settings.reply.section.pace')}
                options={options}
                value={form.pace}
                onChange={(pace) => update({ pace })}
              />
            </Flexbox>
          </Form.Group>
          <Form.Group
            collapsible={false}
            desc={t('settings.reply.section.judgementDesc')}
            extra={saveBar('judgement')}
            keyValue="channel-reply-judgement"
            title={t('settings.reply.section.judgement')}
            variant="filled"
          >
            <Field desc={t('settings.reply.dutiesHint')} label={t('settings.reply.duties')}>
              <TextArea
                aria-label={t('settings.reply.duties')}
                autoSize={{ maxRows: 10, minRows: 4 }}
                maxLength={WAKE_TEXT_MAX_LENGTH}
                placeholder={t('settings.reply.dutiesPlaceholder')}
                value={form.duties}
                onChange={(event) => update({ duties: event.target.value })}
              />
            </Field>
            <Field
              horizontal
              desc={t('settings.reply.instructionsHint')}
              label={t('settings.reply.instructions')}
            >
              <Switch
                aria-label={t('settings.reply.instructions')}
                checked={form.customInstructionsEnabled}
                onChange={(customInstructionsEnabled) => update({ customInstructionsEnabled })}
              />
            </Field>
            {form.customInstructionsEnabled && (
              <Field
                desc={t('settings.reply.instructionsLimit', { count: WAKE_TEXT_MAX_LENGTH })}
                label={t('settings.reply.instructionsContent')}
              >
                <TextArea
                  aria-label={t('settings.reply.instructionsContent')}
                  autoSize={{ maxRows: 10, minRows: 4 }}
                  maxLength={WAKE_TEXT_MAX_LENGTH}
                  placeholder={t('settings.reply.instructionsPlaceholder')}
                  value={form.customInstructions}
                  onChange={(event) => update({ customInstructions: event.target.value })}
                />
              </Field>
            )}
          </Form.Group>
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
