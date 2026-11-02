'use client';

import { Button, Flexbox, Input, TextArea } from '@lobehub/ui';
import { Form, useForm, useWatch } from '@lobehub/ui/form';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AvatarUpload from '@/components/AvatarUpload';
import { type OAuthAppItem, type UpdateOAuthAppParams } from '@/types/oauthApp';

import { useLogoUpload } from '../../useLogoUpload';
import { AppLogoPlaceholder } from '../AppLogo';
import SectionCard from './SectionCard';

const LOGO_SIZE = 64;

interface BasicInfoValues {
  description?: string;
  name: string;
}

interface BasicInfoCardProps {
  canEdit: boolean;
  detail: OAuthAppItem;
  onSubmit: (value: UpdateOAuthAppParams) => Promise<void>;
}

/**
 * Name, logo and description as a form from the start — no separate Edit step.
 * Cancel / Save appear only once something differs from the saved app.
 */
const BasicInfoCard: FC<BasicInfoCardProps> = ({ canEdit, detail, onSubmit }) => {
  const { t } = useTranslation('auth');
  const [saving, setSaving] = useState(false);
  const [logoUri, setLogoUri] = useState<string | null>(detail.logoUri ?? null);
  // Only a logo the user actually touched is sent. Older apps may still hold an
  // inline `data:` logo the server no longer accepts, and renaming such an app
  // must not fail on a field nobody edited.
  const [logoChanged, setLogoChanged] = useState(false);
  const { upload: uploadLogo, uploading: logoUploading } = useLogoUpload();

  const saved = { description: detail.description ?? '', name: detail.name };

  const handleFinish = async (values: BasicInfoValues) => {
    setSaving(true);
    try {
      await onSubmit({
        description: values.description,
        name: values.name.trim(),
        ...(logoChanged ? { logoUri } : {}),
      });
      // The saved values are the new baseline.
      form.reset({ description: values.description ?? '', name: values.name.trim() });
      setLogoChanged(false);
    } finally {
      setSaving(false);
    }
  };

  const form = useForm<BasicInfoValues>({ initialValues: saved, onSubmit: handleFinish });
  const name = useWatch(form, 'name') ?? saved.name;
  const description = useWatch(form, 'description') ?? saved.description;
  const dirty = logoChanged || name !== saved.name || description !== saved.description;

  const handleUpload = async (file: File) => {
    const url = await uploadLogo(file);
    if (!url) return;
    setLogoUri(url);
    setLogoChanged(true);
  };

  const handleDeleteLogo = () => {
    setLogoUri(null);
    setLogoChanged(true);
  };

  const handleCancel = () => {
    form.reset(saved);
    setLogoUri(detail.logoUri ?? null);
    setLogoChanged(false);
  };

  const itemStyle = { paddingBlock: 0 };

  return (
    <SectionCard title={t('oauthApp.detail.basicInfo')}>
      <Form form={form} layout={'vertical'}>
        <Flexbox gap={16}>
          {/* Same logo-beside-name layout as the create modal. */}
          <Flexbox horizontal align={'flex-end'} gap={16}>
            <AvatarUpload
              allowDelete={canEdit && !!logoUri}
              loading={logoUploading}
              placeholder={<AppLogoPlaceholder size={LOGO_SIZE} />}
              size={LOGO_SIZE}
              title={t('oauthApp.form.logo.label')}
              value={logoUri ?? undefined}
              onDelete={handleDeleteLogo}
              onUpload={canEdit ? handleUpload : undefined}
            />
            <Form.Field
              label={t('oauthApp.form.name.label')}
              name={'name'}
              required={t('oauthApp.validation.nameRequired')}
              style={{ ...itemStyle, flex: 1, minWidth: 0 }}
            >
              <Input
                disabled={!canEdit}
                placeholder={t('oauthApp.form.name.placeholder')}
                variant={'filled'}
              />
            </Form.Field>
          </Flexbox>

          <Form.Field
            label={t('oauthApp.form.description.label')}
            name={'description'}
            style={itemStyle}
          >
            <TextArea
              disabled={!canEdit}
              placeholder={t('oauthApp.form.description.placeholder')}
              rows={2}
              variant={'filled'}
            />
          </Form.Field>

          {dirty && (
            <Flexbox horizontal gap={8} justify={'flex-end'}>
              <Button disabled={saving} onClick={handleCancel}>
                {t('oauthApp.detail.cancel')}
              </Button>
              <Button
                disabled={logoUploading}
                htmlType={'submit'}
                loading={saving}
                type={'primary'}
              >
                {t('oauthApp.detail.save')}
              </Button>
            </Flexbox>
          )}
        </Flexbox>
      </Form>
    </SectionCard>
  );
};

export default BasicInfoCard;
