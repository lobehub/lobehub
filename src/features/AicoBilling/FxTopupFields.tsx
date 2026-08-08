'use client';

import { Text } from '@lobehub/ui';
import { Form, InputNumber } from 'antd';
import { type FormInstance } from 'antd/es/form';
import { createStaticStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';

export type FxTopupChargeField = 'toman' | 'usd';

export interface FxTopupFormValues {
  amountToman?: number;
  amountUsd?: number;
}

export const resolveFxTopupPayload = (
  values: FxTopupFormValues,
  chargeField: FxTopupChargeField,
): { amountToman: number } | { amountUsd: string } | null => {
  if (chargeField === 'usd' && values.amountUsd != null && values.amountUsd > 0) {
    return { amountUsd: Number(values.amountUsd).toFixed(6) };
  }
  if (values.amountToman != null && values.amountToman > 0) {
    return { amountToman: values.amountToman };
  }
  return null;
};

const previewUsdFromToman = (toman: number | undefined, rate: number | undefined): string => {
  if (!toman || !rate) return '—';
  return (toman / rate).toFixed(2);
};

const previewTomanFromUsd = (usd: number | undefined, rate: number | undefined): string => {
  if (!usd || !rate) return '—';
  return Math.floor(usd * rate).toLocaleString();
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  fxBanner: css`
    display: flex;
    gap: 8px;
    align-items: baseline;
    justify-content: space-between;

    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  fxRate: css`
    font-size: 15px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorText};
  `,
  fxSource: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  row: css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;

    @media (width <= 520px) {
      grid-template-columns: 1fr;
    }
  `,
}));

interface FxTopupFieldsProps {
  chargeField: FxTopupChargeField;
  disabled?: boolean;
  form: FormInstance<FxTopupFormValues>;
  fxRate?: number;
  fxSource?: string;
  onChargeFieldChange: (field: FxTopupChargeField) => void;
  tomanLabelKey?: string;
  tomanMin?: number;
  usdLabelKey?: string;
  usdMin?: number;
}

export const FxTopupFields = ({
  chargeField,
  disabled = false,
  form,
  fxRate,
  fxSource,
  onChargeFieldChange,
  tomanMin = 1000,
  usdMin = 0.01,
  tomanLabelKey = 'wallet.amountToman',
  usdLabelKey = 'wallet.amountUsd',
}: FxTopupFieldsProps) => {
  const { t } = useTranslation('aico');
  const amountToman = Form.useWatch('amountToman', form);
  const amountUsd = Form.useWatch('amountUsd', form);

  return (
    <>
      <div className={styles.fxBanner}>
        <span className={styles.fxRate}>
          {t('wallet.fxHint', { rate: fxRate?.toLocaleString() ?? '—' })}
        </span>
        {fxSource ? <span className={styles.fxSource}>{fxSource}</span> : null}
      </div>
      <div className={styles.row}>
        <Form.Item label={t(tomanLabelKey)} name="amountToman" style={{ marginBottom: 0 }}>
          <InputNumber
            disabled={disabled}
            min={tomanMin}
            step={1000}
            style={{ width: '100%' }}
            onChange={(value) => {
              onChargeFieldChange('toman');
              if (value != null && fxRate) {
                form.setFieldValue('amountUsd', Number((value / fxRate).toFixed(6)));
              }
            }}
          />
        </Form.Item>
        <Form.Item label={t(usdLabelKey)} name="amountUsd" style={{ marginBottom: 0 }}>
          <InputNumber
            disabled={disabled}
            min={usdMin}
            step={0.5}
            style={{ width: '100%' }}
            onChange={(value) => {
              onChargeFieldChange('usd');
              if (value != null && fxRate) {
                form.setFieldValue('amountToman', Math.floor(value * fxRate));
              }
            }}
          />
        </Form.Item>
      </div>
      <Text type="secondary">
        {chargeField === 'toman'
          ? t('wallet.previewUsd', { usd: previewUsdFromToman(amountToman, fxRate) })
          : t('wallet.previewToman', { toman: previewTomanFromUsd(amountUsd, fxRate) })}
      </Text>
    </>
  );
};
