import { Button } from '@lobehub/ui';
import { CopyIcon, DownloadIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useImgToClipboard } from '@/hooks/useImgToClipboard';
import { ImageType, imageTypeOptions, useScreenshot } from '@/hooks/useScreenshot';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import ExportLayout, { ToolbarDivider } from '../components/ExportLayout';
import { SelectChip, ToggleChip } from '../components/OptionChips';
import { useShareData } from '../ShareDataProvider';
import Preview from './Preview';
import { type FieldType } from './type';
import { WidthMode } from './type';

const DEFAULT_FIELD_VALUE: FieldType = {
  imageType: ImageType.JPG,
  widthMode: WidthMode.Wide,
  withBackground: false,
  withFooter: true,
  withPluginInfo: false,
  withSystemRole: false,
};

const ShareImage = memo<{ mobile?: boolean }>(({ mobile }) => {
  const currentAgentTitle = useAgentStore(agentSelectors.currentAgentDisplayName);
  const [fieldValue, setFieldValue] = useState<FieldType>(
    mobile ? { ...DEFAULT_FIELD_VALUE, widthMode: WidthMode.Narrow } : DEFAULT_FIELD_VALUE,
  );
  const { t } = useTranslation(['chat', 'common']);
  const { context, dbMessages, displayMessages } = useShareData();
  const { loading, onDownload, title } = useScreenshot({
    imageType: fieldValue.imageType,
    title: currentAgentTitle ?? undefined,
  });
  const { loading: copyLoading, onCopy } = useImgToClipboard();

  const update = <K extends keyof FieldType>(key: K, value: FieldType[K]) =>
    setFieldValue((prev) => ({ ...prev, [key]: value }));

  const imageTypeLabel = imageTypeOptions.find((o) => o.key === fieldValue.imageType)?.label;

  return (
    <ExportLayout
      actions={
        <>
          <Button icon={CopyIcon} loading={copyLoading} onClick={() => onCopy()}>
            {t('shareModal.actions.copyImage')}
          </Button>
          <Button icon={DownloadIcon} loading={loading} type={'primary'} onClick={onDownload}>
            {t('shareModal.actions.download')}
          </Button>
        </>
      }
      meta={[t('shareModal.meta.messages', { count: displayMessages.length }), imageTypeLabel].join(
        ' · ',
      )}
      toolbar={
        <>
          <SelectChip
            label={t('shareModal.options.width')}
            value={fieldValue.widthMode}
            options={[
              { label: t('shareModal.widthMode.wide'), value: WidthMode.Wide },
              { label: t('shareModal.widthMode.narrow'), value: WidthMode.Narrow },
            ]}
            onChange={(value) => update('widthMode', value)}
          />
          <SelectChip
            label={t('shareModal.options.fileType')}
            value={fieldValue.imageType}
            options={imageTypeOptions.map((o) => ({
              label: String(o.label),
              value: o.key as ImageType,
            }))}
            onChange={(value) => update('imageType', value)}
          />
          <ToolbarDivider />
          <ToggleChip
            checked={fieldValue.withSystemRole}
            label={t('shareModal.options.agentProfile')}
            onChange={(checked) => update('withSystemRole', checked)}
          />
          <ToggleChip
            checked={fieldValue.withFooter}
            label={t('shareModal.options.footer')}
            onChange={(checked) => update('withFooter', checked)}
          />
        </>
      }
    >
      <Preview context={context} messages={dbMessages} title={title} {...fieldValue} />
    </ExportLayout>
  );
});

export default ShareImage;
