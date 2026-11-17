'use client';

import { type CreateDeveloperWebhookParams, type WebhookEventType } from '@lobechat/types';
import { Button, Flexbox, Input, Switch, Text, TextArea, useModalContext } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EventPicker } from './EventPicker';

const styles = stylex.create({
  error: { fontSize: '12px', color: cssVar.colorError },
  label: { fontSize: '14px', fontWeight: 500 },
  required: { color: cssVar.colorError, marginInlineStart: '2px' },
  submitError: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    fontSize: '13px',
    color: cssVar.colorErrorText,
    backgroundColor: cssVar.colorErrorBg,
    backgroundImage: 'none',
  },
});

const isWebUrl = (value: string) => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

export interface WebhookFormValues {
  description: string;
  enabled: boolean;
  events: WebhookEventType[];
  url: string;
}

export interface WebhookFormContentProps {
  /** Edit mode when present. */
  initialValues?: WebhookFormValues;
  /** Resolve to close the modal; reject with a message to keep it open and show it. */
  onSubmit: (values: CreateDeveloperWebhookParams) => Promise<void>;
}

type FieldErrors = Partial<Record<'events' | 'url', string>>;

export const WebhookFormContent = ({ initialValues, onSubmit }: WebhookFormContentProps) => {
  const { t } = useTranslation('setting');
  const { close, setCanDismissByClickOutside } = useModalContext();
  const [values, setValues] = useState<WebhookFormValues>(
    initialValues ?? { description: '', enabled: true, events: [], url: '' },
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string>();
  const [loading, setLoading] = useState(false);

  // Once the form is dirty a mask click must not drop the input; ✕ / Esc still close.
  const patch = (next: Partial<WebhookFormValues>) => {
    setCanDismissByClickOutside(false);
    setValues((prev) => ({ ...prev, ...next }));
    setErrors((prev) => ({
      ...prev,
      ...('url' in next && { url: undefined }),
      ...('events' in next && { events: undefined }),
    }));
  };

  const validate = (): FieldErrors => {
    const url = values.url.trim();
    const next: FieldErrors = {};
    if (!url) next.url = t('webhook.form.url.required');
    else if (!isWebUrl(url)) next.url = t('webhook.form.url.invalid');
    if (values.events.length === 0) next.events = t('webhook.form.events.required');
    return next;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    setSubmitError(undefined);
    try {
      await onSubmit({
        description: values.description.trim() || null,
        enabled: values.enabled,
        events: values.events,
        url: values.url.trim(),
      });
      close();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form noValidate onSubmit={handleSubmit}>
      <Flexbox gap={20}>
        <Flexbox gap={6}>
          <label htmlFor={'webhook-url'} {...stylex.props(styles.label)}>
            {t('webhook.form.url.label')}
            <span {...stylex.props(styles.required)}>*</span>
          </label>
          <Input
            autoFocus
            aria-invalid={!!errors.url}
            id={'webhook-url'}
            placeholder={t('webhook.form.url.placeholder')}
            value={values.url}
            onChange={(e) => patch({ url: e.target.value })}
          />
          {errors.url && <span {...stylex.props(styles.error)}>{errors.url}</span>}
        </Flexbox>

        <Flexbox gap={6}>
          <label htmlFor={'webhook-description'} {...stylex.props(styles.label)}>
            {t('webhook.form.description.label')}
          </label>
          <TextArea
            autoSize={{ maxRows: 4, minRows: 1 }}
            id={'webhook-description'}
            maxLength={500}
            placeholder={t('webhook.form.description.placeholder')}
            value={values.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Flexbox>

        <Flexbox gap={6}>
          <Flexbox horizontal align={'baseline'} justify={'space-between'}>
            <span {...stylex.props(styles.label)}>
              {t('webhook.form.events.label')}
              <span {...stylex.props(styles.required)}>*</span>
            </span>
            <Text fontSize={12} type={'secondary'}>
              {t('webhook.form.events.selected', { count: values.events.length })}
            </Text>
          </Flexbox>
          <EventPicker value={values.events} onChange={(events) => patch({ events })} />
          {errors.events && <span {...stylex.props(styles.error)}>{errors.events}</span>}
        </Flexbox>

        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <Flexbox gap={2}>
            <span {...stylex.props(styles.label)}>{t('webhook.form.enabled.label')}</span>
            <Text fontSize={12} type={'secondary'}>
              {t('webhook.form.enabled.desc')}
            </Text>
          </Flexbox>
          <Switch
            aria-label={t('webhook.form.enabled.label')}
            checked={values.enabled}
            onChange={(enabled) => patch({ enabled })}
          />
        </Flexbox>

        {submitError && (
          <div role={'alert'} {...stylex.props(styles.submitError)}>
            {submitError}
          </div>
        )}

        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button onClick={close}>{t('webhook.form.cancel')}</Button>
          <Button htmlType={'submit'} loading={loading} type={'primary'}>
            {t(initialValues ? 'webhook.form.submitSave' : 'webhook.form.submitCreate')}
          </Button>
        </Flexbox>
      </Flexbox>
    </form>
  );
};
