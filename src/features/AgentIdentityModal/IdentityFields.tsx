'use client';

import { randomAgentName } from '@lobechat/const';
import { ActionIcon, cssVar, Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import { DicesIcon } from 'lucide-react';
import { memo, type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

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

/** The field values and setters both the edit and the create form expose. */
export interface IdentityFieldsForm {
  description: string;
  error?: string;
  name: string;
  setDescription: (value: string) => void;
  setName: (value: string) => void;
  setSlug: (value: string) => void;
  setTitle: (value: string) => void;
  slug: string;
  slugLocked: boolean;
  title: string;
}

interface IdentityFieldsProps {
  /** The agent being edited, so the dice never suggests its own current name back. */
  agentId?: string;
  form: IdentityFieldsForm;
  /** Overrides the slug placeholder, e.g. to say an empty slug is generated. */
  slugPlaceholder?: string;
}

/** Matches the `agents.description` column width. */
const DESCRIPTION_MAX_LENGTH = 1000;

/** Name / role / description / slug, shared by the edit and the create form. */
const IdentityFields = memo<IdentityFieldsProps>(({ agentId, form, slugPlaceholder }) => {
  const { t } = useTranslation('setting');
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
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
    <>
      <Field label={t('settingAgent.personalName.label')}>
        <Input
          autoFocus
          placeholder={t('settingAgent.personalName.placeholder')}
          value={form.name}
          suffix={
            <ActionIcon
              icon={DicesIcon}
              size={'small'}
              title={t('settingAgent.personalName.roll')}
              onClick={rollName}
            />
          }
          onChange={(e) => form.setName(e.target.value)}
        />
      </Field>
      <Field label={t('settingAgent.role.label')}>
        <Input
          placeholder={t('settingAgent.role.placeholder')}
          value={form.title}
          onChange={(e) => form.setTitle(e.target.value)}
        />
      </Field>
      {/* Other agents read this when they list agents to pick a teammate, so
          the hint says who the text is for. */}
      <Field
        label={t('settingAgent.description.label')}
        hint={
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {t('settingAgent.description.hint')}
          </Text>
        }
      >
        <TextArea
          autoSize={{ maxRows: 6, minRows: 2 }}
          maxLength={DESCRIPTION_MAX_LENGTH}
          placeholder={t('settingAgent.description.inputPlaceholder')}
          value={form.description}
          onChange={(e) => form.setDescription(e.target.value)}
        />
      </Field>
      {/* A builtin agent's identifier is not an editable field at all, so it is
          not dressed as one: a disabled input still reads as "a control you
          can't use right now" and needs a sentence explaining itself. Rendering
          the bare marker states the fact and needs no caption. */}
      {form.slugLocked ? (
        <Field label={t('settingAgent.slug.label')}>
          <Text code style={{ alignSelf: 'flex-start', color: cssVar.colorTextSecondary }}>
            <span style={{ color: cssVar.colorTextTertiary }}>@</span>
            {form.slug}
          </Text>
        </Field>
      ) : (
        <Field
          label={t('settingAgent.slug.label')}
          hint={
            <Text style={{ fontSize: 12 }} type={form.error ? 'danger' : 'secondary'}>
              {/* Show the url the current input actually produces — a literal
                  `<slug>` leaves the reader to do the substitution themselves,
                  and it updates as they type. Only an empty field falls back to
                  describing the field in the abstract. */}
              {form.error ??
                (form.slug.trim()
                  ? t('settingAgent.slug.openWith', { slug: form.slug.trim().toLowerCase() })
                  : t('settingAgent.slug.tooltip'))}
            </Text>
          }
        >
          <Input
            aria-invalid={!!form.error}
            data-invalid={form.error ? '' : undefined}
            placeholder={slugPlaceholder ?? t('settingAgent.slug.placeholder')}
            prefix={'@'}
            value={form.slug}
            onChange={(e) => form.setSlug(e.target.value)}
          />
        </Field>
      )}
    </>
  );
});

export default IdentityFields;
