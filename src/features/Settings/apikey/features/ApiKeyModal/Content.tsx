'use client';

import { CopyButton, Flexbox, Icon, Input } from '@lobehub/ui';
import { Button, Select, Text, useModalContext } from '@lobehub/ui/base-ui';
import { Form } from 'antd';
import { createStaticStyles } from 'antd-style';
import { type Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { CheckCircle2 } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { API_KEY_FULL_ACCESS_SCOPE, type ApiKeyScope } from '@/const/apiKeyScope';
import { type CreateApiKeyParams } from '@/types/apiKey';

import ApiKeyDatePicker from '../ApiKeyDatePicker';
import ScopeSelector from './ScopeSelector';

const styles = createStaticStyles(({ css, cssVar }) => ({
  keyBlock: css`
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};
  `,
  keyText: css`
    flex: 1;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    word-break: break-all;
  `,
  successIcon: css`
    color: ${cssVar.colorSuccess};
  `,
}));

type FormValues = Omit<CreateApiKeyParams, 'expiresAt' | 'scopes'>;

/** 'never' and 'custom' plus day-count presets, Vercel-token style. */
const EXPIRY_PRESETS = ['never', '7', '30', '60', '90', '180', '365', 'custom'] as const;
type ExpiryPreset = (typeof EXPIRY_PRESETS)[number];

const PRESET_LABEL_KEYS = {
  '7': 'apikey.form.fields.expiresAt.presets.7d',
  '30': 'apikey.form.fields.expiresAt.presets.30d',
  '60': 'apikey.form.fields.expiresAt.presets.60d',
  '90': 'apikey.form.fields.expiresAt.presets.90d',
  '180': 'apikey.form.fields.expiresAt.presets.180d',
  '365': 'apikey.form.fields.expiresAt.presets.1y',
  'custom': 'apikey.form.fields.expiresAt.presets.custom',
  'never': 'apikey.display.neverExpires',
} as const satisfies Record<ExpiryPreset, string>;

export interface ApiKeyModalContentProps {
  onSubmit: (values: CreateApiKeyParams) => Promise<{ key?: string | null } | void>;
}

const ApiKeyModalContent: FC<ApiKeyModalContentProps> = ({ onSubmit }) => {
  const { t } = useTranslation('auth');
  const { close } = useModalContext();
  const [form] = Form.useForm<FormValues>();
  const [loading, setLoading] = useState(false);
  const [fullAccess, setFullAccess] = useState(true);
  const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>([]);
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>('never');
  const [customDate, setCustomDate] = useState<Dayjs | null>(null);
  // Filled once creation succeeds; flips the modal to the copy-now step.
  const [createdKey, setCreatedKey] = useState<string>();

  const scopeMissing = !fullAccess && selectedScopes.length === 0;
  // "Custom date" without a date would silently fall back to never-expires.
  const customDateMissing = expiryPreset === 'custom' && !customDate;

  // The preset resolves to a date at submit time, so a form left open does not
  // silently shorten the key's lifetime.
  const resolveExpiresAt = (): Date | null => {
    if (expiryPreset === 'never') return null;
    if (expiryPreset === 'custom') return customDate ? customDate.toDate() : null;
    return dayjs().add(Number(expiryPreset), 'day').hour(23).minute(59).second(59).toDate();
  };

  const handleFinish = async (values: FormValues) => {
    if (scopeMissing || customDateMissing) return;

    setLoading(true);
    try {
      const created = await onSubmit({
        ...values,
        expiresAt: resolveExpiresAt(),
        scopes: fullAccess ? [API_KEY_FULL_ACCESS_SCOPE] : selectedScopes,
      } satisfies CreateApiKeyParams);
      if (created?.key) {
        setCreatedKey(created.key);
      } else {
        close();
      }
    } finally {
      setLoading(false);
    }
  };

  if (createdKey) {
    return (
      <Flexbox gap={16}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon className={styles.successIcon} icon={CheckCircle2} size={18} />
          <Text style={{ fontWeight: 500 }}>{t('apikey.created.title')}</Text>
        </Flexbox>
        <Flexbox horizontal align={'center'} className={styles.keyBlock} gap={8}>
          <span className={styles.keyText}>{createdKey}</span>
          <CopyButton content={createdKey} size={'small'} title={t('apikey.display.copy')} />
        </Flexbox>
        <Text style={{ fontSize: 12 }} type={'secondary'}>
          {t('apikey.created.hint')}
        </Text>
        <Button block type={'primary'} onClick={() => close()}>
          {t('apikey.created.done')}
        </Button>
      </Flexbox>
    );
  }

  const itemStyle = { marginBottom: 0 };

  return (
    <Form colon={false} form={form} layout={'vertical'} onFinish={handleFinish}>
      <Flexbox gap={16}>
        <Form.Item
          label={t('apikey.form.fields.name.label')}
          name={'name'}
          rules={[{ required: true }]}
          style={itemStyle}
        >
          <Input placeholder={t('apikey.form.fields.name.placeholder')} />
        </Form.Item>

        <Form.Item label={t('apikey.form.fields.expiresAt.label')} style={itemStyle}>
          <Flexbox gap={8}>
            <Select
              value={expiryPreset}
              options={EXPIRY_PRESETS.map((preset) => ({
                label: t(PRESET_LABEL_KEYS[preset]),
                value: preset,
              }))}
              onChange={(value) => setExpiryPreset(value as ExpiryPreset)}
            />
            {expiryPreset === 'custom' && (
              <ApiKeyDatePicker
                showNeverExpiresFooter={false}
                style={{ width: '100%' }}
                value={customDate}
                onChange={setCustomDate}
              />
            )}
          </Flexbox>
        </Form.Item>

        <Form.Item
          help={scopeMissing ? t('apikey.form.fields.scopes.required') : undefined}
          label={t('apikey.form.fields.scopes.label')}
          style={itemStyle}
          validateStatus={scopeMissing ? 'error' : undefined}
        >
          <ScopeSelector
            fullAccess={fullAccess}
            selected={selectedScopes}
            onFullAccessChange={setFullAccess}
            onSelectedChange={setSelectedScopes}
          />
        </Form.Item>

        <Button
          block
          disabled={scopeMissing || customDateMissing}
          htmlType={'submit'}
          loading={loading}
          type={'primary'}
        >
          {t('apikey.form.submit')}
        </Button>
      </Flexbox>
    </Form>
  );
};

export default ApiKeyModalContent;
