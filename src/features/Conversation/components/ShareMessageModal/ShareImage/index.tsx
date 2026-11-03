import { agentDisplayName, type UIChatMessage } from '@lobechat/types';
import { Button, Flexbox, Switch, Tabs } from '@lobehub/ui';
import { Form, type FormFieldProps, useForm } from '@lobehub/ui/form';
import { CopyIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useImgToClipboard } from '@/hooks/useImgToClipboard';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ImageType, imageTypeOptions, useScreenshot } from '@/hooks/useScreenshot';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { contextSelectors, useConversationStore } from '../../../store';
import { styles } from '../style';
import Preview from './Preview';
import { type FieldType, WidthMode } from './type';

const DEFAULT_FIELD_VALUE: FieldType = {
  imageType: ImageType.JPG,
  widthMode: WidthMode.Wide,
  withBackground: false,
  withFooter: true,
};

const ShareImage = memo<{ message: UIChatMessage; mobile?: boolean; uniqueId?: string }>(
  ({ message, uniqueId }) => {
    const agentId = useConversationStore(contextSelectors.agentId);
    const currentAgentTitle = useAgentStore((s) =>
      agentDisplayName(agentSelectors.getAgentMetaById(agentId)(s)),
    );
    const context = useConversationStore((s) => s.context);
    const [fieldValue, setFieldValue] = useState<FieldType>(DEFAULT_FIELD_VALUE);
    const form = useForm({
      initialValues: DEFAULT_FIELD_VALUE,
      onValuesChange: (_, v) => setFieldValue(v),
    });
    const { t } = useTranslation(['chat', 'common']);

    const widthModeOptions = [
      { key: WidthMode.Wide, label: t('shareModal.widthMode.wide') },
      { key: WidthMode.Narrow, label: t('shareModal.widthMode.narrow') },
    ];

    // Generate a unique preview ID to avoid DOM conflicts
    const previewId = uniqueId ? `preview-${uniqueId}` : 'preview';

    const { loading, onDownload, title } = useScreenshot({
      id: `#${previewId}`,
      imageType: fieldValue.imageType,
      title: currentAgentTitle ?? undefined,
    });
    const { loading: copyLoading, onCopy } = useImgToClipboard({ id: `#${previewId}` });
    const settings: FormFieldProps<FieldType>[] = [
      {
        children: <Tabs items={widthModeOptions} />,
        label: t('shareModal.widthMode.label'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'widthMode',
        valueProp: 'activeKey',
      },
      {
        children: <Switch />,
        label: t('shareModal.withBackground'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'withBackground',
      },
      {
        children: <Switch />,
        label: t('shareModal.withFooter'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'withFooter',
      },
      {
        children: <Tabs items={imageTypeOptions} />,
        label: t('shareModal.imageType'),
        layout: 'vertical',
        minWidth: undefined,
        name: 'imageType',
        valueProp: 'activeKey',
      },
    ];

    const isMobile = useIsMobile();

    const button = (
      <>
        <Button
          block
          icon={CopyIcon}
          loading={copyLoading}
          size={isMobile ? undefined : 'large'}
          type={'primary'}
          onClick={() => onCopy()}
        >
          {t('copy', { ns: 'common' })}
        </Button>
        <Button block loading={loading} size={isMobile ? undefined : 'large'} onClick={onDownload}>
          {t('shareModal.download')}
        </Button>
      </>
    );

    return (
      <>
        <Flexbox className={styles.body} gap={16} horizontal={!isMobile}>
          <Preview
            context={context}
            title={title}
            {...fieldValue}
            message={message}
            previewId={previewId}
          />
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
  },
);

export default ShareImage;
