'use client';

import { type OAuthAppType } from '@lobechat/types';
import { Button, Flexbox, Icon, Input, Text, TextArea, useModalContext } from '@lobehub/ui';
import { Form, useForm, useWatch } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, GlobeIcon, type LucideIcon, TerminalIcon } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AvatarUpload from '@/components/AvatarUpload';
import { type CreateOAuthAppParams } from '@/types/oauthApp';

import { useLogoUpload } from '../../useLogoUpload';
import { AppLogoPlaceholder } from '../AppLogo';

const LOGO_SIZE = 64;

const styles = stylex.create({
  typeCard: {
    cursor: 'pointer',
    position: 'relative',
    flex: '1',
    minWidth: '0',
    padding: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    transition: 'border-color 0.15s ease, background 0.15s ease',
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorBorder },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  // LobeHub's primary is a near-black neutral, so the selection rides a
  // text-colored border alone — no fill, which read as a disabled block.
  typeCardSelected: { borderColor: cssVar.colorText },
  typeCheck: { flex: 'none', marginInlineStart: 'auto', color: cssVar.colorText },
  typeDesc: { fontSize: '12px', lineHeight: 1.5, color: cssVar.colorTextTertiary },
  typeIcon: {
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

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
          className={stylex.props(styles.typeCard, selected && styles.typeCardSelected).className}
          gap={8}
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
          <Flexbox horizontal align={'center'} gap={8}>
            <span {...stylex.props(styles.typeIcon)}>
              <Icon icon={option.icon} size={16} />
            </span>
            <Text weight={500}>{option.title}</Text>
            {selected && (
              <Icon
                className={stylex.props(styles.typeCheck).className}
                icon={CheckIcon}
                size={16}
              />
            )}
          </Flexbox>
          <span {...stylex.props(styles.typeDesc)}>{option.description}</span>
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
  const { t } = useTranslation(['auth', 'common']);
  const { close, setCanDismissByClickOutside } = useModalContext();
  const [loading, setLoading] = useState(false);
  const [logoUri, setLogoUri] = useState<string>();

  // Once the form is dirty, a mask click must not dismiss the modal (it would
  // silently drop the user's input); the explicit ✕/ESC close still works.
  const markDirty = () => setCanDismissByClickOutside(false);

  const form = useForm<CreateAppFormValues>({
    initialValues: { type: 'device' } as CreateAppFormValues,
    onSubmit: (values) => handleFinish(values),
    onValuesChange: markDirty,
  });
  const type = useWatch(form, 'type');

  const { upload: uploadLogo, uploading: logoUploading } = useLogoUpload();

  const handleUpload = async (file: File) => {
    const url = await uploadLogo(file);
    if (!url) return;
    setLogoUri(url);
    markDirty();
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

  const itemStyle = { paddingBlock: 0 };

  return (
    <Form form={form} layout={'vertical'}>
      <Flexbox gap={16}>
        {/* The logo sits beside the name, the way the app will appear in lists
            and on the consent screen, instead of taking a row of its own. */}
        <Flexbox horizontal align={'flex-end'} gap={16}>
          <AvatarUpload
            allowDelete={!!logoUri}
            loading={logoUploading}
            placeholder={<AppLogoPlaceholder dashed size={LOGO_SIZE} />}
            size={LOGO_SIZE}
            title={t('oauthApp.form.logo.label')}
            value={logoUri}
            onDelete={() => setLogoUri(undefined)}
            onUpload={handleUpload}
          />
          <Form.Field
            label={t('oauthApp.form.name.label')}
            name={'name'}
            required={t('oauthApp.validation.nameRequired')}
            style={{ ...itemStyle, flex: 1, minWidth: 0 }}
          >
            <Input placeholder={t('oauthApp.form.name.placeholder')} />
          </Form.Field>
        </Flexbox>

        <Form.Field
          label={t('oauthApp.form.type.label')}
          name={'type'}
          style={itemStyle}
          extra={
            <Flexbox gap={2} style={{ fontSize: 12, marginTop: 8 }}>
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
        </Form.Field>

        <Form.Field
          label={t('oauthApp.form.description.label')}
          name={'description'}
          style={itemStyle}
        >
          <TextArea placeholder={t('oauthApp.form.description.placeholder')} rows={2} />
        </Form.Field>

        <Flexbox horizontal gap={8} justify={'flex-end'} style={{ marginTop: 8 }}>
          <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
          <Button disabled={logoUploading} htmlType={'submit'} loading={loading} type={'primary'}>
            {t('oauthApp.form.submit')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Form>
  );
};

export default CreateAppModalContent;
