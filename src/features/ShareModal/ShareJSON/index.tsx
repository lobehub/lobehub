import { FORM_STYLE } from '@lobechat/const';
import { type TopicExportMode } from '@lobechat/types';
import { exportFile } from '@lobechat/utils/client';
import { type FormItemProps } from '@lobehub/ui';
import { copyToClipboard, Flexbox, Form } from '@lobehub/ui';
import { Button, Switch, Tabs, toast } from '@lobehub/ui/base-ui';
import { CopyIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';

import { useShareData } from '../ShareDataProvider';
import { styles } from '../style';
import { useExportMessages } from '../useExportMessages';
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

  const exportModeOptions = useMemo(
    () => [
      { key: 'full' as TopicExportMode, label: t('shareModal.exportMode.full') },
      { key: 'simple' as TopicExportMode, label: t('shareModal.exportMode.simple') },
    ],
    [t],
  );

  const settings: FormItemProps[] = [
    {
      children: (
        <Tabs
          activeKey={fieldValue.exportMode}
          items={exportModeOptions}
          styles={{
            list: { display: 'flex', width: '100%' },
            tab: { flex: 1 },
          }}
          onChange={(key) =>
            setFieldValue((prev) => ({ ...prev, exportMode: key as TopicExportMode }))
          }
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

  const { dbMessages, systemRole, title, topic } = useShareData();
  // Tool bodies the read path left on the server would otherwise serialize as
  // empty strings and be lost on re-import — see `useExportMessages`.
  const { isHydrating, isIncomplete, messages: exportMessages } = useExportMessages(dbMessages);

  // Always include tool messages (includeTool: true)
  const data =
    fieldValue.exportMode === 'simple'
      ? generateMessages({
          ...fieldValue,
          includeTool: true,
          messages: exportMessages,
          systemRole: systemRole ?? '',
        })
      : generateFullExport({
          ...fieldValue,
          includeTool: true,
          messages: exportMessages,
          systemRole: systemRole ?? '',
          topic: topic ?? undefined,
        });

  const content = JSON.stringify(data, null, 2);

  const isMobile = useIsMobile();

  const button = (
    <>
      <Button
        block
        // Both actions serialize `content`; until the omitted tool bodies land
        // it is still the projected view, which would export as empty results.
        disabled={isHydrating || isIncomplete}
        icon={CopyIcon}
        loading={isHydrating}
        size={isMobile ? undefined : 'large'}
        type={'primary'}
        onClick={async () => {
          await copyToClipboard(content);
          toast.success(t('copySuccess', { ns: 'common' }));
        }}
      >
        {t('copy', { ns: 'common' })}
      </Button>
      <Button
        block
        disabled={isHydrating || isIncomplete}
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
