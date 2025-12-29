import { FORM_STYLE } from '@lobechat/const';
import { type TopicExportMode } from '@lobechat/types';
import { exportFile } from '@lobechat/utils/client';
import { Button, Form, type FormItemProps, copyToClipboard } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { App, Segmented, Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { CopyIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { dbMessageSelectors, topicSelectors } from '@/store/chat/selectors';

import { styles } from '../style';
import Preview from './Preview';
import { generateFullExport } from './generateFullExport';
import { generateMessages } from './generateMessages';
import { type FieldType } from './type';

const DEFAULT_FIELD_VALUE: FieldType = {
  exportMode: 'full',
  includeTool: true,
  withSystemRole: true,
};

const ShareJSON = memo(() => {
  const [fieldValue, setFieldValue] = useState(DEFAULT_FIELD_VALUE);
  const { t } = useTranslation(['chat', 'common']);
  const { message } = App.useApp();

  const exportModeOptions = useMemo(
    () => [
      { label: t('shareModal.exportMode.full'), value: 'full' as TopicExportMode },
      { label: t('shareModal.exportMode.simple'), value: 'simple' as TopicExportMode },
    ],
    [t],
  );

  const settings: FormItemProps[] = [
    {
      children: (
        <Segmented
          block
          onChange={(value) => setFieldValue((prev) => ({ ...prev, exportMode: value }))}
          options={exportModeOptions}
          value={fieldValue.exportMode}
        />
      ),
      label: t('shareModal.exportMode.label'),
      layout: 'vertical',
      minWidth: undefined,
      name: 'exportMode',
    },
    {
      children: <Switch />,
      label: t('shareModal.withSystemRole'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'withSystemRole',
      valuePropName: 'checked',
    },
  ];

  const systemRole = useAgentStore(agentSelectors.currentAgentSystemRole);
  const messages = useChatStore(dbMessageSelectors.activeDbMessages, isEqual);
  const topic = useChatStore(topicSelectors.currentActiveTopic, isEqual);

  // Always include tool messages (includeTool: true)
  const data =
    fieldValue.exportMode === 'simple'
      ? generateMessages({ ...fieldValue, includeTool: true, messages, systemRole })
      : generateFullExport({
          ...fieldValue,
          includeTool: true,
          messages,
          systemRole,
          topic: topic ?? undefined,
        });

  const content = JSON.stringify(data, null, 2);

  const title = topic?.title || t('shareModal.exportTitle');

  const isMobile = useIsMobile();

  const button = (
    <>
      <Button
        block
        icon={CopyIcon}
        onClick={async () => {
          await copyToClipboard(content);
          message.success(t('copySuccess', { ns: 'common' }));
        }}
        size={isMobile ? undefined : 'large'}
        type={'primary'}
      >
        {t('copy', { ns: 'common' })}
      </Button>
      <Button
        block
        onClick={() => {
          exportFile(content, `${title}.json`);
        }}
        size={isMobile ? undefined : 'large'}
      >
        {t('shareModal.downloadFile')}
      </Button>
    </>
  );

  return (
    <>
      <Flexbox className={styles.body} gap={16} horizontal={!isMobile}>
        <Preview content={content} />
        <Flexbox className={styles.sidebar} gap={12}>
          <Form
            initialValues={DEFAULT_FIELD_VALUE}
            items={settings}
            itemsType={'flat'}
            onValuesChange={(_, v) => setFieldValue(v)}
            {...FORM_STYLE}
          />
          {!isMobile && button}
        </Flexbox>
      </Flexbox>
      {isMobile && (
        <Flexbox className={styles.footer} gap={8} horizontal>
          {button}
        </Flexbox>
      )}
    </>
  );
});

export default ShareJSON;
