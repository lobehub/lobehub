'use client';

import { Flexbox, Input } from '@lobehub/ui';
import { ActionIcon, Alert, Button, Text } from '@lobehub/ui/base-ui';
import { Form } from 'antd';
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
  // antd's ErrorList only picks up error styling inside a Form.Item that has an
  // error status; the list-level message sits outside one, so it is colored here.
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

  return (
    <SectionCard
      title={t('oauthApp.redirectUris.title')}
      extra={
        !editing && (
          <Button
            disabled={!canEdit}
            icon={<PencilIcon size={14} />}
            size={'small'}
            onClick={() => setEditing(true)}
          >
            {t(saved.length > 0 ? 'oauthApp.detail.edit' : 'oauthApp.redirectUris.configure')}
          </Button>
        )
      }
    >
      {editing ? (
        <Form
          colon={false}
          initialValues={{ redirectUris: saved.length > 0 ? saved : [''] }}
          layout={'vertical'}
          onFinish={handleFinish}
        >
          <Flexbox gap={12}>
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('oauthApp.form.redirectUris.extra')}
            </Text>

            <Form.List
              name={'redirectUris'}
              rules={[
                {
                  validator: async (_, values?: (string | undefined)[]) => {
                    const messageKey = redirectUriListMessageKey(values);
                    if (messageKey)
                      throw new Error(t(messageKey, { count: MAX_OAUTH_REDIRECT_URIS }));
                  },
                },
              ]}
            >
              {(fields, { add, remove }, { errors }) => (
                <Flexbox gap={8}>
                  {fields.map((field) => (
                    <Flexbox horizontal align={'flex-start'} gap={8} key={field.key}>
                      <Form.Item
                        name={field.name}
                        style={{ flex: 1, marginBottom: 0 }}
                        rules={[
                          {
                            validator: async (_, value?: string) => {
                              const messageKey = redirectUriMessageKey(value);
                              if (messageKey) throw new Error(t(messageKey));
                            },
                          },
                        ]}
                      >
                        <Input placeholder={t('oauthApp.form.redirectUris.placeholder')} />
                      </Form.Item>
                      <ActionIcon
                        aria-label={t('oauthApp.redirectUris.remove')}
                        icon={Trash2Icon}
                        style={{ marginTop: 4 }}
                        title={t('oauthApp.redirectUris.remove')}
                        onClick={() => remove(field.name)}
                      />
                    </Flexbox>
                  ))}

                  {errors.length > 0 && <div className={styles.listError}>{errors}</div>}

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
