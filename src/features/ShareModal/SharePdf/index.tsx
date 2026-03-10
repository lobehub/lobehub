import { type UIChatMessage } from '@lobechat/types';
import { type FormItemProps } from '@lobehub/ui';
import { Button, Flexbox, Form } from '@lobehub/ui';
import { App, Switch } from 'antd';
import { cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { DownloadIcon, FileText } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatSelectors, topicSelectors } from '@/store/chat/selectors';

import { generateMarkdown } from '../ShareText/template';
import { type FieldType } from '../ShareText/type';
import { containerStyles, styles } from '../style';
import PdfPreview from './PdfPreview';
import { usePdfGeneration } from './usePdfGeneration';

const DEFAULT_FIELD_VALUE: FieldType = {
  includeTool: true,
  includeUser: true,
  withRole: true,
  withSystemRole: false,
};

const SharePdf = memo((props: { message?: UIChatMessage }) => {
  const [fieldValue, setFieldValue] = useState(DEFAULT_FIELD_VALUE);
  const { t } = useTranslation(['chat', 'common']);
  const { message } = App.useApp();

  const { message: outerMessage } = props;
  const isMobile = useIsMobile();

  const settings: FormItemProps[] = [
    {
      children: <Switch />,
      label: t('shareModal.withSystemRole'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'withSystemRole',
      valuePropName: 'checked',
    },
    {
      children: <Switch />,
      label: t('shareModal.withRole'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'withRole',
      valuePropName: 'checked',
    },
    {
      children: <Switch />,
      label: t('shareModal.includeUser'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'includeUser',
      valuePropName: 'checked',
    },
    {
      children: <Switch />,
      label: t('shareModal.includeTool'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'includeTool',
      valuePropName: 'checked',
    },
  ];

  // Use the same data gathering logic as ShareText
  const [systemRole] = useAgentStore((s) => [agentSelectors.currentAgentSystemRole(s)]);
  const messages = useChatStore(chatSelectors.activeBaseChats, isEqual);
  const topic = useChatStore(topicSelectors.currentActiveTopic, isEqual);
  const activeId = useChatStore((s) => s.activeAgentId);
  const topicId = useChatStore((s) => s.activeTopicId);

  const title = topic?.title || t('shareModal.exportTitle');

  const { generatePdf, downloadPdf, pdfData, loading, error } = usePdfGeneration();

  const handleGeneratePdf = async () => {
    if (activeId && messages.length > 0) {
      // Generate markdown with current field values
      const currentMarkdownContent = generateMarkdown({
        ...fieldValue,
        messages: outerMessage ? [outerMessage] : messages,
        systemRole,
        title,
      }).replaceAll('\n\n\n', '\n');

      if (currentMarkdownContent.trim()) {
        await generatePdf({
          content: currentMarkdownContent,
          sessionId: activeId,
          title,
          topicId: topicId || undefined,
        });
      }
    }
  };

  // Update configuration when form changes
  const handleConfigChange = (_changedValues: any, allValues: FieldType) => {
    setFieldValue(allValues);
  };

  const handleDownload = async () => {
    if (pdfData) {
      try {
        await downloadPdf();
        message.success(t('shareModal.downloadSuccess'));
      } catch {
        message.error(t('shareModal.downloadError'));
      }
    }
  };

  const generateButton = (
    <Button
      block
      disabled={loading}
      icon={loading ? undefined : FileText}
      loading={loading}
      size={isMobile ? undefined : 'large'}
      type="primary"
      onClick={handleGeneratePdf}
    >
      {loading
        ? t('shareModal.generatingPdf')
        : pdfData
          ? t('shareModal.regeneratePdf')
          : t('shareModal.generatePdf')}
    </Button>
  );

  const downloadButton = pdfData ? (
    <Button
      block
      icon={DownloadIcon}
      size={isMobile ? undefined : 'large'}
      type="default"
      onClick={handleDownload}
    >
      {t('shareModal.downloadPdf')}
    </Button>
  ) : null;

  if (error) {
    return (
      <Flexbox className={styles.body} gap={16} horizontal={!isMobile}>
        <div
          className={cx(containerStyles.preview, containerStyles.previewWide)}
          style={{ padding: 12 }}
        >
          <div style={{ color: 'red', textAlign: 'center' }}>
            {t('shareModal.pdfGenerationError')}: {error}
          </div>
        </div>
        <Flexbox className={styles.sidebar} gap={12}>
          <div>{t('shareModal.pdfErrorDescription')}</div>
          <Form
            initialValues={DEFAULT_FIELD_VALUE}
            items={settings}
            itemsType={'flat'}
            onValuesChange={handleConfigChange}
            {...FORM_STYLE}
          />
          {generateButton}
        </Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.body} gap={16} horizontal={!isMobile}>
      <PdfPreview loading={loading} pdfData={pdfData} onGeneratePdf={handleGeneratePdf} />
      <Flexbox className={styles.sidebar} gap={12}>
        <Form
          initialValues={DEFAULT_FIELD_VALUE}
          items={settings}
          itemsType={'flat'}
          onValuesChange={handleConfigChange}
          {...FORM_STYLE}
        />
        {pdfData && generateButton}
        {downloadButton}
      </Flexbox>
    </Flexbox>
  );
});

export default SharePdf;
