'use client';

import { Flexbox, Input, TextArea } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { Form } from 'antd';
import { PencilIcon } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AvatarUpload from '@/components/AvatarUpload';
import { type OAuthAppItem, type UpdateOAuthAppParams } from '@/types/oauthApp';

import { useLogoUpload } from '../../useLogoUpload';
import SectionCard from './SectionCard';

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
 * Name, logo and description, read-only until the user asks to edit. The edit
 * form mounts fresh from the saved values each time, so cancelling needs no
 * reset and a half-typed change never lingers into the next edit.
 */
const BasicInfoCard: FC<BasicInfoCardProps> = ({ canEdit, detail, onSubmit }) => {
  const { t } = useTranslation('auth');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoUri, setLogoUri] = useState<string | null>(detail.logoUri ?? null);
  // Only a logo the user actually touched is sent. Older apps may still hold an
  // inline `data:` logo the server no longer accepts, and renaming such an app
  // must not fail on a field nobody edited.
  const [logoChanged, setLogoChanged] = useState(false);
  const { upload: uploadLogo, uploading: logoUploading } = useLogoUpload();

  const startEditing = () => {
    setLogoUri(detail.logoUri ?? null);
    setLogoChanged(false);
    setEditing(true);
  };

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

  const handleFinish = async (values: BasicInfoValues) => {
    setSaving(true);
    try {
      await onSubmit({
        description: values.description,
        name: values.name.trim(),
        ...(logoChanged ? { logoUri } : {}),
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const itemStyle = { marginBottom: 0 };

  return (
    <SectionCard
      title={t('oauthApp.detail.basicInfo')}
      extra={
        !editing && (
          <Button
            disabled={!canEdit}
            icon={<PencilIcon size={14} />}
            size={'small'}
            onClick={startEditing}
          >
            {t('oauthApp.detail.edit')}
          </Button>
        )
      }
    >
      {editing ? (
        <Form
          colon={false}
          initialValues={{ description: detail.description ?? '', name: detail.name }}
          layout={'vertical'}
          onFinish={handleFinish}
        >
          <Flexbox gap={16}>
            <Form.Item label={t('oauthApp.form.logo.label')} style={itemStyle}>
              <AvatarUpload
                allowDelete={!!logoUri}
                loading={logoUploading}
                title={detail.name}
                value={logoUri ?? undefined}
                onDelete={handleDeleteLogo}
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
              label={t('oauthApp.form.description.label')}
              name={'description'}
              style={itemStyle}
            >
              <TextArea placeholder={t('oauthApp.form.description.placeholder')} rows={3} />
            </Form.Item>

            <Flexbox horizontal gap={8} justify={'flex-end'}>
              <Button onClick={() => setEditing(false)}>{t('oauthApp.detail.cancel')}</Button>
              <Button
                disabled={logoUploading}
                htmlType={'submit'}
                loading={saving}
                type={'primary'}
              >
                {t('oauthApp.detail.save')}
              </Button>
            </Flexbox>
          </Flexbox>
        </Form>
      ) : (
        <Flexbox horizontal align={'center'} gap={16}>
          <AvatarUpload title={detail.name} value={detail.logoUri ?? undefined} />
          <Flexbox gap={4} style={{ minWidth: 0 }}>
            <Text strong style={{ fontSize: 16 }}>
              {detail.name}
            </Text>
            <Text type={'secondary'}>
              {detail.description || t('oauthApp.detail.noDescription')}
            </Text>
          </Flexbox>
        </Flexbox>
      )}
    </SectionCard>
  );
};

export default BasicInfoCard;
