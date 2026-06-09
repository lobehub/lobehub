'use client';

import { BRANDING_EMAIL } from '@lobechat/business-const';
import { Button, Flexbox, Icon } from '@lobehub/ui';
import { useModalContext } from '@lobehub/ui/base-ui';
import { App, Form, Input, Upload } from 'antd';
import { ImagePlus, Send } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import TextArea from '@/components/TextArea';
import { lambdaClient } from '@/libs/trpc/client';
import { useFileStore } from '@/store/file';
import { userProfileSelectors } from '@/store/user/selectors';
import { useUserStore } from '@/store/user/store';

import type { FeedbackInitialValues } from './types';

interface FeedbackContentProps {
  initialValues?: FeedbackInitialValues;
}

interface FormValues {
  message: string;
  title: string;
}

const FeedbackContent = memo<FeedbackContentProps>(({ initialValues }) => {
  const { t } = useTranslation('common');
  const { message } = App.useApp();
  const { close } = useModalContext();
  const [form] = Form.useForm<FormValues>();

  const [loading, setLoading] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);

  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const userEmail = useUserStore(userProfileSelectors.email);

  const handleScreenshotUpload = useCallback(
    async (file: File) => {
      const MAX_SIZE = 5 * 1024 * 1024; // 5MB
      if (file.size > MAX_SIZE) {
        message.error(t('feedback.errors.fileTooLarge'));
        return;
      }

      setUploadingScreenshot(true);
      try {
        const result = await uploadWithProgress({ file });
        if (result?.url) {
          setScreenshotUrl(result.url);
          message.success(t('feedback.screenshotUploaded'));
        }
      } catch (error) {
        console.error('[FeedbackModal] Screenshot upload failed:', error);
        message.error(t('feedback.errors.uploadFailed'));
      } finally {
        setUploadingScreenshot(false);
      }
    },
    [message, t, uploadWithProgress],
  );

  const handleRemoveScreenshot = useCallback(() => {
    setScreenshotUrl(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      await lambdaClient.market.submitFeedback.mutate({
        clientInfo: {
          language: navigator.language,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          url: window.location.href,
          userAgent: navigator.userAgent,
        },
        email: userEmail || undefined,
        message: values.message,
        screenshotUrl: screenshotUrl || undefined,
        title: values.title,
      });

      message.success(t('feedback.success'));
      form.resetFields();
      setScreenshotUrl(null);
      close();
    } catch (error: any) {
      console.error('[FeedbackModal] Submission failed:', error);
      message.error(t('feedback.errors.submitFailed'));
    } finally {
      setLoading(false);
    }
  }, [close, form, message, screenshotUrl, t, userEmail]);

  const handleCancel = useCallback(() => {
    form.resetFields();
    setScreenshotUrl(null);
    close();
  }, [close, form]);

  return (
    <Flexbox gap={16}>
      <p style={{ color: 'var(--colorTextSecondary)', fontSize: 14, margin: 0 }}>
        <Trans
          i18nKey="feedback.emailContact"
          ns="common"
          values={{ email: BRANDING_EMAIL.business }}
          components={{
            email: (
              <a
                href={`mailto:${BRANDING_EMAIL.business}`}
                rel="noopener noreferrer"
                style={{ color: 'inherit', textDecoration: 'underline' }}
                target="_blank"
              />
            ),
          }}
        />
      </p>

      <Form form={form} initialValues={initialValues} layout="vertical">
        <Form.Item
          label={t('feedback.fields.title.label')}
          name="title"
          rules={[
            { message: t('feedback.fields.title.required'), required: true },
            { max: 200, message: t('feedback.fields.title.maxLength') },
          ]}
        >
          <Input showCount maxLength={200} placeholder={t('feedback.fields.title.placeholder')} />
        </Form.Item>

        <Form.Item
          label={t('feedback.fields.message.label')}
          name="message"
          rules={[
            { message: t('feedback.fields.message.required'), required: true },
            { max: 5000, message: t('feedback.fields.message.maxLength') },
          ]}
        >
          <TextArea
            showCount
            maxLength={5000}
            placeholder={t('feedback.fields.message.placeholder')}
            rows={6}
          />
        </Form.Item>

        <Form.Item label={t('feedback.fields.screenshot.label')} style={{ marginBottom: 0 }}>
          <Flexbox gap={8}>
            {screenshotUrl ? (
              <Flexbox gap={8}>
                <img
                  alt="Screenshot"
                  src={screenshotUrl}
                  style={{ borderRadius: 8, maxHeight: 200, maxWidth: '100%' }}
                />
                <Button danger disabled={uploadingScreenshot} onClick={handleRemoveScreenshot}>
                  {t('feedback.fields.screenshot.remove')}
                </Button>
              </Flexbox>
            ) : (
              <Upload
                accept="image/*"
                showUploadList={false}
                beforeUpload={(file) => {
                  handleScreenshotUpload(file);
                  return false;
                }}
              >
                <Button icon={<Icon icon={ImagePlus} />} loading={uploadingScreenshot}>
                  {uploadingScreenshot
                    ? t('feedback.fields.screenshot.uploading')
                    : t('feedback.fields.screenshot.upload')}
                </Button>
              </Upload>
            )}
          </Flexbox>
          <p style={{ color: 'var(--colorTextSecondary)', fontSize: 12, marginTop: 8 }}>
            {t('feedback.fields.screenshot.hint')}
          </p>
        </Form.Item>
      </Form>

      <Flexbox horizontal gap={8} justify="flex-end">
        <Button onClick={handleCancel}>{t('cancel')}</Button>
        <Button icon={<Icon icon={Send} />} loading={loading} type="primary" onClick={handleSubmit}>
          {t('feedback.submit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

FeedbackContent.displayName = 'FeedbackContent';

export default FeedbackContent;
