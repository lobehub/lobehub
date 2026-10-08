'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Alert, Button, Input, Text } from '@lobehub/ui/base-ui';
import { Form, useForm } from '@lobehub/ui/base-ui/form';
import { createStaticStyles } from 'antd-style';
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type OAuthAppItem, type UpdateOAuthAppParams } from '@/types/oauthApp';

import {
  MAX_OAUTH_REDIRECT_URIS,
  normalizeRedirectUris,
  redirectUriListMessageKey,
  redirectUriMessageKey,
} from '../../redirectUris';
import SectionCard from './SectionCard';

const styles = createStaticStyles(({ css, cssVar }) => ({
  fieldError: css`
    font-size: 12px;
    color: ${cssVar.colorError};
  `,
  listError: css`
    font-size: 14px;
    line-height: 1.5;
    color: ${cssVar.colorError};
  `,
  uri: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
    overflow-wrap: anywhere;

    background: ${cssVar.colorFillQuaternary};
  `,
}));

interface RedirectUrisValues {
  redirectUris: string[];
}

interface RedirectUrisCardProps {
  canEdit: boolean;
  detail: OAuthAppItem;
  onSubmit: (value: UpdateOAuthAppParams) => Promise<void>;
}

/**
 * The redirect URIs a web app may send users back to. A freshly created app has
 * none, which is a legitimate "not yet configured" state shown as a warning;
 * once the user opens the editor, a save needs at least one URI.
 */
const RedirectUrisCard: FC<RedirectUrisCardProps> = ({ canEdit, detail, onSubmit }) => {
  const { t } = useTranslation('auth');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const saved = detail.redirectUris ?? [];

  const handleFinish = async ({ redirectUris }: RedirectUrisValues) => {
    setSaving(true);
    try {
      await onSubmit({ redirectUris: normalizeRedirectUris(redirectUris ?? []) });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const form = useForm<RedirectUrisValues>({ onSubmit: handleFinish });

  const startEditing = () => {
    form.reset({ redirectUris: saved.length > 0 ? saved : [''] });
    setEditing(true);
  };

  return (
    <SectionCard
      title={t('oauthApp.redirectUris.title')}
      extra={
        !editing && (
          <Button
            disabled={!canEdit}
            icon={<PencilIcon size={14} />}
            size={'small'}
            onClick={startEditing}
          >
            {t(saved.length > 0 ? 'oauthApp.detail.edit' : 'oauthApp.redirectUris.configure')}
          </Button>
        )
      }
    >
      {editing ? (
        <Form form={form} layout={'vertical'}>
          <Flexbox gap={12}>
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('oauthApp.form.redirectUris.extra')}
            </Text>

            <Form.List name={'redirectUris'}>
              {({ fields, add, remove }) => (
                <Flexbox gap={8}>
                  {fields.map((field) => (
                    <Flexbox horizontal align={'flex-start'} gap={8} key={field.key}>
                      <Form.Field
                        bare
                        name={`redirectUris.${field.index}`}
                        render={({ error, onBlur, onChange, value }) => (
                          <Flexbox flex={1} gap={4}>
                            <Input
                              aria-invalid={error ? true : undefined}
                              placeholder={t('oauthApp.form.redirectUris.placeholder')}
                              value={value}
                              onBlur={onBlur}
                              onChange={(e) => onChange(e.target.value)}
                            />
                            {error && <div className={styles.fieldError}>{error}</div>}
                          </Flexbox>
                        )}
                        validate={(value?: string) => {
                          const messageKey = redirectUriMessageKey(value);
                          return messageKey ? t(messageKey) : undefined;
                        }}
                      />
                      <ActionIcon
                        aria-label={t('oauthApp.redirectUris.remove')}
                        icon={Trash2Icon}
                        style={{ marginTop: 4 }}
                        title={t('oauthApp.redirectUris.remove')}
                        onClick={() => remove(field.index)}
                      />
                    </Flexbox>
                  ))}

                  <Form.Field
                    bare
                    name={'redirectUris'}
                    render={({ error }) =>
                      error ? <div className={styles.listError}>{error}</div> : null
                    }
                    validate={(values?: (string | undefined)[]) => {
                      const messageKey = redirectUriListMessageKey(values);
                      return messageKey
                        ? t(messageKey, { count: MAX_OAUTH_REDIRECT_URIS })
                        : undefined;
                    }}
                  />

                  <Button
                    block
                    disabled={fields.length >= MAX_OAUTH_REDIRECT_URIS}
                    icon={<PlusIcon size={14} />}
                    onClick={() => add('')}
                  >
                    {t('oauthApp.redirectUris.add')}
                  </Button>
                </Flexbox>
              )}
            </Form.List>

            <Flexbox horizontal gap={8} justify={'flex-end'}>
              <Button onClick={() => setEditing(false)}>{t('oauthApp.detail.cancel')}</Button>
              <Button htmlType={'submit'} loading={saving} type={'primary'}>
                {t('oauthApp.detail.save')}
              </Button>
            </Flexbox>
          </Flexbox>
        </Form>
      ) : saved.length > 0 ? (
        <Flexbox gap={6}>
          {saved.map((uri) => (
            <div className={styles.uri} key={uri}>
              {uri}
            </div>
          ))}
        </Flexbox>
      ) : (
        <Alert showIcon message={t('oauthApp.redirectUris.empty')} type={'warning'} />
      )}
    </SectionCard>
  );
};

export default RedirectUrisCard;
