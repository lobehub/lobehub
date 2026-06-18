'use client';

import { InboxOutlined } from '@ant-design/icons';
import { Button } from '@lobehub/ui';
import { useMutation } from '@tanstack/react-query';
import { Form, Input, message, Upload } from 'antd';
import { createStaticStyles } from 'antd-style';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCredsApi } from '../useCredsApi';

const styles = createStaticStyles(({ css }) => ({
  footer: css`
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-block-start: 24px;
  `,
}));

interface FileCredFormProps {
  disabled?: boolean;
  onBack: () => void;
  onSuccess: () => void;
}

interface FormValues {
  description?: string;
  key: string;
  name: string;
}

const FileCredForm: FC<FileCredFormProps> = ({ disabled, onBack, onSuccess }) => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm<FormValues>();
  const [fileHashId, setFileHashId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const credsApi = useCredsApi();

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
    if (disabled) return false;

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

      // Upload via TRPC (personal or workspace, based on active CredsApi context)
      const result = await credsApi.client.uploadFile.mutate({
        file: base64,
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
      });

      setFileName(result.fileName);
      setFileHashId(result.fileHashId);
      message.success(t('creds.file.uploadSuccess'));
    } catch (error) {
      console.error('[FileCredForm] Upload failed:', error);
      message.error(error instanceof Error ? error.message : t('creds.file.uploadFailed'));
    } finally {
      setIsUploading(false);
    }

    return false; // Prevent default upload
  };

  const handleSubmit = (values: FormValues) => {
    if (disabled) return;

    if (!fileHashId) {
      message.error(t('creds.form.fileRequired'));
      return;
    }
    createMutation.mutate(values);
  };

  return (
    <Form<FormValues> form={form} layout="vertical" onFinish={handleSubmit}>
      <Form.Item required label={t('creds.form.file')}>
        <Upload.Dragger
          beforeUpload={handleUpload}
          disabled={isUploading || disabled}
          maxCount={1}
          showUploadList={fileName ? { showRemoveIcon: true } : false}
          onRemove={() => {
            setFileHashId(null);
            setFileName('');
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">
            {isUploading ? t('creds.file.uploading') : t('creds.form.uploadHint')}
          </p>
          <p className="ant-upload-hint">{t('creds.form.uploadDesc')}</p>
        </Upload.Dragger>
        {fileName && (
          <div style={{ marginTop: 8 }}>
            {t('creds.form.selectedFile')}: {fileName}
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
