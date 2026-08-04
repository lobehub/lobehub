'use client';

import { randomAgentName } from '@lobechat/const';
import { ActionIcon, Flexbox, Input, Text } from '@lobehub/ui';
import { Button, useModalContext } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { DicesIcon } from 'lucide-react';
import { memo, type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

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
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const form = useAgentIdentityForm({ agentId, onSaved: close });
  const { setName } = form;

  // Same draw as the header's "name it for me" button: the pool matches the
  // user's language, and names already visible in the sidebar are excluded so
  // the dice never suggests a second "佳宁". Read at click time — the list only
  // matters at the moment of the roll.
  const rollName = useCallback(() => {
    const takenNames = homeAgentListSelectors
      .allAgents(useHomeStore.getState())
      .filter((agent) => agent.id !== agentId)
      .map((agent) => agent.name)
      .filter((name): name is string => !!name);

    setName(randomAgentName(locale, takenNames));
  }, [agentId, locale, setName]);

  return (
    <Flexbox gap={20} padding={20}>
      <Field label={t('settingAgent.personalName.label', { ns: 'setting' })}>
        <Input
          autoFocus
          placeholder={t('settingAgent.personalName.placeholder', { ns: 'setting' })}
          value={form.name}
          suffix={
            <ActionIcon
              icon={DicesIcon}
              size={'small'}
              title={t('settingAgent.personalName.roll', { ns: 'setting' })}
              onClick={rollName}
            />
          }
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
      {/* A builtin agent's identifier is not an editable field at all, so it is
          not dressed as one: a disabled input still reads as "a control you
          can't use right now" and needs a sentence explaining itself. Rendering
          the bare marker states the fact and needs no caption. */}
      {form.slugLocked ? (
        <Field label={t('settingAgent.slug.label', { ns: 'setting' })}>
          <Text code style={{ alignSelf: 'flex-start', color: cssVar.colorTextSecondary }}>
            <span style={{ color: cssVar.colorTextTertiary }}>@</span>
            {form.slug}
          </Text>
        </Field>
      ) : (
        <Field
          label={t('settingAgent.slug.label', { ns: 'setting' })}
          hint={
            <Text style={{ fontSize: 12 }} type={form.error ? 'danger' : 'secondary'}>
              {/* Show the url the current input actually produces — a literal
                  `<slug>` leaves the reader to do the substitution themselves,
                  and it updates as they type. Only an empty field falls back to
                  describing the field in the abstract. */}
              {form.error ??
                (form.slug.trim()
                  ? t('settingAgent.slug.openWith', {
                      ns: 'setting',
                      slug: form.slug.trim().toLowerCase(),
                    })
                  : t('settingAgent.slug.tooltip', { ns: 'setting' }))}
            </Text>
          }
        >
          <Input
            placeholder={t('settingAgent.slug.placeholder', { ns: 'setting' })}
            prefix={'@'}
            status={form.error ? 'error' : undefined}
            value={form.slug}
            onChange={(e) => form.setSlug(e.target.value)}
          />
        </Field>
      )}
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
