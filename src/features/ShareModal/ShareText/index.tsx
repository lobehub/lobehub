import { exportFile } from '@lobechat/utils/client';
import { formatSize } from '@lobechat/utils/format';
import { Button, copyToClipboard, toast } from '@lobehub/ui';
import { CopyIcon, DownloadIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ExportLayout from '../components/ExportLayout';
import { useShareData } from '../ShareDataProvider';
import { useExportMessages } from '../useExportMessages';
import Preview from './Preview';
import { generateMarkdown } from './template';
import TextOptions from './TextOptions';
import { type FieldType } from './type';

const DEFAULT_FIELD_VALUE: FieldType = {
  includeTool: true,
  includeUser: true,
  withRole: true,
  withSystemRole: false,
};

const ShareText = memo(() => {
  const [fieldValue, setFieldValue] = useState(DEFAULT_FIELD_VALUE);
  const { t } = useTranslation(['chat', 'common']);

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

  const disabled = isHydrating || isIncomplete;

  return (
    <ExportLayout
      toolbar={<TextOptions value={fieldValue} onChange={setFieldValue} />}
      actions={
        <>
          <Button
            disabled={disabled}
            icon={CopyIcon}
            loading={isHydrating}
            onClick={async () => {
              await copyToClipboard(content);
              toast.success(t('copySuccess', { ns: 'common' }));
            }}
          >
            {t('shareModal.actions.copyText')}
          </Button>
          <Button
            disabled={disabled}
            icon={DownloadIcon}
            type={'primary'}
            onClick={() => exportFile(content, `${title}.md`)}
          >
            {t('shareModal.actions.download')}
          </Button>
        </>
      }
      meta={[
        t('shareModal.meta.messages', { count: displayMessages.length }),
        formatSize(new Blob([content]).size),
        '.md',
      ].join(' · ')}
    >
      <Preview content={content} />
    </ExportLayout>
  );
});

export default ShareText;
