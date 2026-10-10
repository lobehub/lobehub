import { FORM_STYLE } from '@lobechat/const';
import { exportFile } from '@lobechat/utils/client';
import { Button, copyToClipboard, Flexbox, Switch, toast } from '@lobehub/ui';
import { Form, type FormFieldProps, useForm } from '@lobehub/ui/form';
import { CopyIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';

import { useShareData } from '../ShareDataProvider';
import { styles } from '../style';
import { useExportMessages } from '../useExportMessages';
import Preview from './Preview';
import { generateMarkdown } from './template';
import { type FieldType } from './type';

const DEFAULT_FIELD_VALUE: FieldType = {
  includeTool: true,
  includeUser: true,
  withRole: true,
  withSystemRole: false,
};

const ShareText = memo(() => {
  const [fieldValue, setFieldValue] = useState(DEFAULT_FIELD_VALUE);
  const form = useForm({
    initialValues: DEFAULT_FIELD_VALUE,
    onValuesChange: (_, v) => setFieldValue(v),
  });
  const { t } = useTranslation(['chat', 'common']);

  const settings: FormFieldProps<FieldType>[] = [
    {
      children: <Switch />,
      label: t('shareModal.withSystemRole'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'withSystemRole',
    },
    {
      children: <Switch />,
      label: t('shareModal.withRole'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'withRole',
    },
    {
      children: <Switch />,
      label: t('shareModal.includeUser'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'includeUser',
    },
    {
      children: <Switch />,
      label: t('shareModal.includeTool'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'includeTool',
    },
  ];

  const { displayMessages, systemRole, title } = useShareData();
  // Markdown serializes each tool's `content` too, so the same omitted rows
  // would export as empty code blocks — see `useExportMessages`.
  const {
    isHydrating,
    isIncomplete,
    messages: exportMessages,
  } = useExportMessages(displayMessages);
  const content = generateMarkdown({
    ...fieldValue,
    messages: exportMessages,
    systemRole: systemRole ?? '',
    title,
  }).replaceAll('\n\n\n', '\n');

  const isMobile = useIsMobile();

  const button = (
    <>
      <Button
        block
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
          exportFile(content, `${title}.md`);
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
          <Form form={form} items={settings} itemsType={'flat'} {...FORM_STYLE} />
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

export default ShareText;
