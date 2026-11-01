import { type TopicExportMode } from '@lobechat/types';
import { exportFile } from '@lobechat/utils/client';
import { formatSize } from '@lobechat/utils/format';
import { Button, copyToClipboard, toast } from '@lobehub/ui';
import { CopyIcon, DownloadIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ExportLayout, { ToolbarDivider } from '../components/ExportLayout';
import { SelectChip, ToggleChip } from '../components/OptionChips';
import { useShareData } from '../ShareDataProvider';
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

  const { dbMessages, displayMessages, systemRole, title, topic } = useShareData();
  // Tool bodies the read path left on the server would otherwise serialize as
  // empty strings and be lost on re-import — see `useExportMessages`.
  const { isHydrating, isIncomplete, messages: exportMessages } = useExportMessages(dbMessages);

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
  // Both actions serialize `content`; until the omitted tool bodies land it is
  // still the projected view, which would export as empty results.
  const disabled = isHydrating || isIncomplete;

  return (
    <ExportLayout
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
            {t('shareModal.actions.copyJson')}
          </Button>
          <Button
            disabled={disabled}
            icon={DownloadIcon}
            type={'primary'}
            onClick={() => exportFile(content, `${title}.json`)}
          >
            {t('shareModal.actions.download')}
          </Button>
        </>
      }
      meta={[
        t('shareModal.meta.messages', { count: displayMessages.length }),
        formatSize(new Blob([content]).size),
        '.json',
      ].join(' · ')}
      toolbar={
        <>
          <SelectChip<TopicExportMode>
            label={t('shareModal.options.schema')}
            value={fieldValue.exportMode}
            options={[
              { label: t('shareModal.exportMode.full'), value: 'full' },
              { label: t('shareModal.exportMode.simple'), value: 'simple' },
            ]}
            onChange={(exportMode) => setFieldValue((prev) => ({ ...prev, exportMode }))}
          />
          <ToolbarDivider />
          <ToggleChip
            checked={fieldValue.withSystemRole}
            label={t('shareModal.options.agentProfile')}
            onChange={(withSystemRole) => setFieldValue((prev) => ({ ...prev, withSystemRole }))}
          />
        </>
      }
    >
      <Preview content={content} />
    </ExportLayout>
  );
});

export default ShareJSON;
