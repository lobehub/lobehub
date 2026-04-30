'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Button, Flexbox, Text } from '@lobehub/ui';
import { Input, Tag } from 'antd';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaClient } from '@/libs/trpc/client';

import type { SaveCredsParams } from '../../../types';
import { styles } from './style';

const SecureCredentialForm = memo<BuiltinInterventionProps<SaveCredsParams>>(
  ({ args, interactionMode, onInteractionAction }) => {
    const { t } = useTranslation('ui');
    const isCustom = interactionMode === 'custom';
    const { key, name, type, fields = [], description } = args;

    const [values, setValues] = useState<Record<string, string>>(() => {
      const init: Record<string, string> = {};
      for (const field of fields) {
        init[field.name] = '';
      }
      return init;
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string>();

    const allFilled = fields.every((f) => values[f.name]?.trim());

    const handleSave = useCallback(async () => {
      if (!onInteractionAction || !allFilled) return;

      setSubmitting(true);
      setError(undefined);

      try {
        // Save credential directly via tRPC — values never enter AI context
        await lambdaClient.market.creds.createKV.mutate({
          description,
          key,
          name,
          type: type as 'kv-env' | 'kv-header',
          values,
        });

        // Notify the tool chain with success metadata only (no secret values)
        await onInteractionAction({
          payload: { key, name, success: true },
          type: 'submit',
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save credential');
        setSubmitting(false);
      }
    }, [allFilled, description, key, name, onInteractionAction, type, values]);

    const handleSkip = useCallback(async () => {
      if (!onInteractionAction) return;
      await onInteractionAction({
        reason: 'User cancelled secure credential input',
        type: 'skip',
      });
    }, [onInteractionAction]);

    // Non-custom mode: show summary only (standard approve/reject buttons handle it)
    if (!isCustom) {
      return (
        <Flexbox gap={8}>
          <Text>
            {t('common.save', { defaultValue: 'Save' })}: {name}
          </Text>
          <Text style={{ fontSize: 13 }} type="secondary">
            {t('common.type', { defaultValue: 'Type' })}: {type} | Key: {key}
          </Text>
          {fields.length > 0 && (
            <Text style={{ fontSize: 12 }} type="secondary">
              {fields.map((f) => f.label || f.name).join(', ')}
            </Text>
          )}
        </Flexbox>
      );
    }

    return (
      <div className={styles.root}>
        <div className={styles.header}>
          <Text style={{ fontWeight: 500 }}>🔐 {name}</Text>
          {description && (
            <Text style={{ fontSize: 13 }} type="secondary">
              {description}
            </Text>
          )}
          <Flexbox horizontal gap={4}>
            <Tag className={styles.tag}>{key}</Tag>
            <Tag className={styles.tag}>{type}</Tag>
          </Flexbox>
        </div>

        <Flexbox gap={8}>
          {fields.map((field) => (
            <Flexbox gap={4} key={field.name}>
              <span className={styles.fieldLabel}>{field.label || field.name}</span>
              <Input.Password
                autoComplete="off"
                placeholder={field.name}
                status={error ? 'error' : undefined}
                value={values[field.name]}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                onPressEnter={() => {
                  if (allFilled) handleSave();
                }}
              />
            </Flexbox>
          ))}
        </Flexbox>

        {error && (
          <Text style={{ fontSize: 12 }} type="danger">
            {error}
          </Text>
        )}

        <div className={styles.footer}>
          <Button onClick={handleSkip}>{t('form.skip', { defaultValue: 'Skip' })}</Button>
          <Button disabled={!allFilled} loading={submitting} type="primary" onClick={handleSave}>
            {t('common.save', { defaultValue: 'Save' })}
          </Button>
        </div>
      </div>
    );
  },
);

SecureCredentialForm.displayName = 'SecureCredentialForm';

export default SecureCredentialForm;
