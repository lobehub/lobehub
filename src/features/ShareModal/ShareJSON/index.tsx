import { FORM_STYLE } from '@lobechat/const';
import { type TopicExportMode } from '@lobechat/types';
import { exportFile } from '@lobechat/utils/client';
import { type FormItemProps } from '@lobehub/ui';
import { Button, copyToClipboard, Flexbox, Form } from '@lobehub/ui';
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
import { generateFullExport } from './generateFullExport';
import { generateMessages } from './generateMessages';
import Preview from './Preview';
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
          options={exportModeOptions}
          value={fieldValue.exportMode}
          onChange={(value) => setFieldValue((prev) => ({ ...prev, exportMode: value }))}
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
        size={isMobile ? undefined : 'large'}
        type={'primary'}
        onClick={async () => {
          await copyToClipboard(content);
          message.success(t('copySuccess', { ns: 'common' }));
        }}
      >
        {t('copy', { ns: 'common' })}
      </Button>
      <Button
        block
        size={isMobile ? undefined : 'large'}
        onClick={() => {
          exportFile(content, `${title}.json`);
        }}
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
        <Flexbox horizontal className={styles.footer} gap={8}>
          {button}
        </Flexbox>
      )}
    </>
  );
});

export default ShareJSON;
