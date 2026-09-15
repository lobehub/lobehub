'use client';

import { type OAuthAppType } from '@lobechat/types';
import { Flexbox, Icon, Input, TextArea } from '@lobehub/ui';
import { Button, Text, useModalContext } from '@lobehub/ui/base-ui';
import { Form } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { CheckIcon, GlobeIcon, type LucideIcon, TerminalIcon } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AvatarUpload from '@/components/AvatarUpload';
import { type CreateOAuthAppParams } from '@/types/oauthApp';

const styles = createStaticStyles(({ css, cssVar }) => ({
  typeCard: css`
    cursor: pointer;

    position: relative;

    flex: 1;

    padding: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    transition:
      border-color 0.15s ease,
      background 0.15s ease;

    &:hover {
      border-color: ${cssVar.colorBorder};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorBorder};
      outline-offset: 2px;
    }
  `,
  // LobeHub's primary is a near-black neutral, so the selection rides a
  // text-colored border and a light fill instead of `colorPrimaryBg`.
  typeCardSelected: css`
    border-color: ${cssVar.colorText};
    background: ${cssVar.colorFillQuaternary};

    &:hover {
      border-color: ${cssVar.colorText};
    }
  `,
  typeCheck: css`
    position: absolute;
    inset-block-start: 12px;
    inset-inline-end: 12px;
    color: ${cssVar.colorText};
  `,
  typeDesc: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  typeIcon: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillTertiary};
  `,
}));

interface TypeOption {
  description: string;
  icon: LucideIcon;
  title: string;
  value: OAuthAppType;
}

interface TypeSelectProps {
  onChange?: (value: OAuthAppType) => void;
  options: TypeOption[];
  value?: OAuthAppType;
}

const TypeSelect: FC<TypeSelectProps> = ({ onChange, options, value }) => (
  <Flexbox horizontal gap={12} role={'radiogroup'}>
    {options.map((option) => {
      const selected = option.value === value;

      return (
        <Flexbox
          aria-checked={selected}
          className={cx(styles.typeCard, selected && styles.typeCardSelected)}
          gap={10}
          key={option.value}
          role={'radio'}
          tabIndex={0}
          onClick={() => onChange?.(option.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onChange?.(option.value);
            }
          }}
        >
          <span className={styles.typeIcon}>
            <Icon icon={option.icon} size={18} />
          </span>
          <Text weight={500}>{option.title}</Text>
          <span className={styles.typeDesc}>{option.description}</span>
          {selected && <Icon className={styles.typeCheck} icon={CheckIcon} size={16} />}
        </Flexbox>
      );
    })}
  </Flexbox>
);

interface CreateAppFormValues {
  description?: string;
  name: string;
  type: OAuthAppType;
}

export interface CreateAppModalContentProps {
  onSubmit: (values: CreateOAuthAppParams) => Promise<void>;
}

const CreateAppModalContent: FC<CreateAppModalContentProps> = ({ onSubmit }) => {
  const { t } = useTranslation('auth');
  const { close, setCanDismissByClickOutside } = useModalContext();
  const [form] = Form.useForm<CreateAppFormValues>();
  const type = Form.useWatch('type', form);
  const [loading, setLoading] = useState(false);
  const [logoUri, setLogoUri] = useState<string>();

  // Once the form is dirty, a mask click must not dismiss the modal (it would
  // silently drop the user's input); the explicit ✕/ESC close still works.
  const markDirty = () => setCanDismissByClickOutside(false);

  const handleUpload = (file: File) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      setLogoUri(reader.result as string);
      markDirty();
    });
    reader.readAsDataURL(file);
  };

  // Only what defines the app is asked for up front. Redirect URIs are
  // configured on the app page afterwards; the type is not, because it decides
  // whether a client secret is issued and cannot change once the app exists.
  const handleFinish = async (values: CreateAppFormValues) => {
    setLoading(true);
    try {
      await onSubmit({
        description: values.description,
        logoUri,
        name: values.name,
        type: values.type,
      });
      close();
    } finally {
      setLoading(false);
    }
  };

  const itemStyle = { marginBottom: 0 };

  return (
    <Form
      colon={false}
      form={form}
      initialValues={{ type: 'device' }}
      layout={'vertical'}
      onFinish={handleFinish}
      onValuesChange={markDirty}
    >
      <Flexbox gap={16}>
        <Form.Item label={t('oauthApp.form.logo.label')} style={itemStyle}>
          <AvatarUpload
            title={t('oauthApp.form.name.label')}
            value={logoUri}
            onUpload={handleUpload}
          />
        </Form.Item>

        <Form.Item
          label={t('oauthApp.form.name.label')}
          name={'name'}
          rules={[{ message: t('oauthApp.validation.nameRequired'), required: true }]}
          style={itemStyle}
        >
          <Input placeholder={t('oauthApp.form.name.placeholder')} />
        </Form.Item>

        <Form.Item
          label={t('oauthApp.form.type.label')}
          name={'type'}
          style={itemStyle}
          extra={
            <Flexbox gap={2} style={{ marginTop: 8 }}>
              <span>{t('oauthApp.form.type.immutable')}</span>
              {type === 'web' && <span>{t('oauthApp.form.type.webNext')}</span>}
            </Flexbox>
          }
        >
          <TypeSelect
            options={[
              {
                description: t('oauthApp.form.type.deviceDesc'),
                icon: TerminalIcon,
                title: t('oauthApp.type.device'),
                value: 'device',
              },
              {
                description: t('oauthApp.form.type.webDesc'),
                icon: GlobeIcon,
                title: t('oauthApp.type.web'),
                value: 'web',
              },
            ]}
          />
        </Form.Item>

        <Form.Item
          label={t('oauthApp.form.description.label')}
          name={'description'}
          style={itemStyle}
        >
          <TextArea placeholder={t('oauthApp.form.description.placeholder')} rows={3} />
        </Form.Item>

        <Button block htmlType={'submit'} loading={loading} type={'primary'}>
          {t('oauthApp.form.submit')}
        </Button>
      </Flexbox>
    </Form>
  );
};

export default CreateAppModalContent;
