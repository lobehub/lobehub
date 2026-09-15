'use client';

import { Button, toast, Upload } from '@lobehub/ui/base-ui';
import { useMutation } from '@tanstack/react-query';
import { Form, Input } from 'antd';
import { createStaticStyles } from 'antd-style';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type CredsApi } from '../useCredsApi';

const styles = createStaticStyles(({ css }) => ({
  footer: css`
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-block-start: 24px;
  `,
}));

interface FileCredFormProps {
  credsApi: CredsApi;
  disabled?: boolean;
  onBack: () => void;
  onSuccess: () => void;
}

interface FormValues {
  description?: string;
  key: string;
  name: string;
}

const FileCredForm: FC<FileCredFormProps> = ({ credsApi, disabled, onBack, onSuccess }) => {
  const { t } = useTranslation(['setting', 'common']);
  const [form] = Form.useForm<FormValues>();
  const [fileHashId, setFileHashId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);

  const createMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (disabled) return;

      if (!fileHashId || !fileName) {
        throw new Error('File is required');
      }

      await credsApi.client.createFile.mutate({
        description: values.description,
        fileHashId,
        fileName,
        key: values.key,
        name: values.name,
      });
    },
    onSuccess: () => {
      onSuccess();
    },
  });

  const handleUpload = async (file: File) => {
    if (disabled) return;

    setIsUploading(true);

    try {
      // Convert file to base64
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      // Upload via TRPC (personal or workspace, based on the credsApi passed in by the caller)
      const result = await credsApi.client.uploadFile.mutate({
        file: base64,
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
      });

      setFileName(result.fileName);
      setFileHashId(result.fileHashId);
      toast.success(t('creds.file.uploadSuccess'));
    } catch (error) {
      console.error('[FileCredForm] Upload failed:', error);
      toast.error(error instanceof Error ? error.message : t('creds.file.uploadFailed'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = (values: FormValues) => {
    if (disabled) return;

    if (!fileHashId) {
      toast.error(t('creds.form.fileRequired'));
      return;
    }
    createMutation.mutate(values);
  };

  return (
    <Form<FormValues> form={form} layout="vertical" onFinish={handleSubmit}>
      <Form.Item required label={t('creds.form.file')}>
        <Upload
          dragger
          description={t('creds.form.uploadDesc')}
          disabled={isUploading || disabled}
          maxCount={1}
          title={isUploading ? t('creds.file.uploading') : t('creds.form.uploadHint')}
          onFiles={([file]) => handleUpload(file)}
        />
        {fileName && (
          <div style={{ alignItems: 'center', display: 'flex', gap: 8, marginTop: 8 }}>
            <span>
              {t('creds.form.selectedFile')}: {fileName}
            </span>
            <Button
              size="small"
              type="text"
              onClick={() => {
                setFileHashId(null);
                setFileName('');
              }}
            >
              {t('delete', { ns: 'common' })}
            </Button>
          </div>
        )}
      </Form.Item>

      <Form.Item
        label={t('creds.form.key')}
        name="key"
        rules={[
          { required: true, message: t('creds.form.keyRequired') },
          { pattern: /^[\w-]+$/, message: t('creds.form.keyPattern') },
        ]}
      >
        <Input disabled={disabled} placeholder="e.g., gcp-service-account" />
      </Form.Item>

      <Form.Item
        label={t('creds.form.name')}
        name="name"
        rules={[{ required: true, message: t('creds.form.nameRequired') }]}
      >
        <Input disabled={disabled} placeholder="e.g., GCP Service Account" />
      </Form.Item>

      <Form.Item label={t('creds.form.description')} name="description">
        <Input.TextArea
          disabled={disabled}
          placeholder={t('creds.form.descriptionPlaceholder')}
          rows={2}
        />
      </Form.Item>

      <div className={styles.footer}>
        <Button onClick={onBack}>{t('creds.form.back')}</Button>
        <Button
          disabled={!fileHashId || disabled}
          htmlType="submit"
          loading={createMutation.isPending}
          type="primary"
        >
          {t('creds.form.submit')}
        </Button>
      </div>
    </Form>
  );
};

export default FileCredForm;
