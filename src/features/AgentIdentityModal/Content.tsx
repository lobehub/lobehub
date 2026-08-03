'use client';

import { Flexbox, Input, Text } from '@lobehub/ui';
import { Button, useModalContext } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentIdentityForm } from './useAgentIdentityForm';

interface FieldProps {
  children: ReactNode;
  hint?: ReactNode;
  label: string;
}

const Field = memo<FieldProps>(({ label, hint, children }) => (
  <Flexbox gap={6}>
    <Text type={'secondary'}>{label}</Text>
    {children}
    {hint}
  </Flexbox>
));

interface AgentIdentityContentProps {
  agentId: string;
}

/**
 * The three identity fields as a real form. They used to be inline inputs in the
 * profile header, which crowded it and left no room for a per-field label or
 * error. All behaviour lives in {@link useAgentIdentityForm}.
 */
const AgentIdentityContent = memo<AgentIdentityContentProps>(({ agentId }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { close } = useModalContext();
  const form = useAgentIdentityForm({ agentId, onSaved: close });

  return (
    <Flexbox gap={20} padding={20}>
      <Field label={t('settingAgent.personalName.label', { ns: 'setting' })}>
        <Input
          autoFocus
          placeholder={t('settingAgent.personalName.placeholder', { ns: 'setting' })}
          value={form.name}
          onChange={(e) => form.setName(e.target.value)}
        />
      </Field>
      <Field label={t('settingAgent.role.label', { ns: 'setting' })}>
        <Input
          placeholder={t('settingAgent.role.placeholder', { ns: 'setting' })}
          value={form.title}
          onChange={(e) => form.setTitle(e.target.value)}
        />
      </Field>
      <Field
        label={t('settingAgent.slug.label', { ns: 'setting' })}
        hint={
          <Text style={{ fontSize: 12 }} type={form.error ? 'danger' : 'secondary'}>
            {form.error ?? t('settingAgent.slug.tooltip', { ns: 'setting' })}
          </Text>
        }
      >
        <Input
          placeholder={t('settingAgent.slug.placeholder', { ns: 'setting' })}
          prefix={'@'}
          status={form.error ? 'error' : undefined}
          // The slug is a technical identifier, not prose — it reads at the same
          // weight as the hint under it rather than competing with name and role.
          style={{ color: cssVar.colorTextSecondary }}
          value={form.slug}
          onChange={(e) => form.setSlug(e.target.value)}
        />
      </Field>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={form.saving} onClick={() => close()}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button
          disabled={form.saving}
          loading={form.saving}
          type={'primary'}
          onClick={() => {
            void form.save();
          }}
        >
          {t('save', { ns: 'common' })}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

export default AgentIdentityContent;
