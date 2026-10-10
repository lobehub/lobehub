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

import { useShareData } from '../ShareDataProvider';
import { styles } from '../style';
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

const ShareImage = memo<{ mobile?: boolean }>(() => {
  const currentAgentTitle = useAgentStore(agentSelectors.currentAgentDisplayName);
  const [fieldValue, setFieldValue] = useState<FieldType>(DEFAULT_FIELD_VALUE);
  const form = useForm({
    initialValues: DEFAULT_FIELD_VALUE,
    onValuesChange: (_, v) => setFieldValue(v),
  });
  const { t } = useTranslation(['chat', 'common']);
  const { context, dbMessages } = useShareData();
  const { loading, onDownload, title } = useScreenshot({
    imageType: fieldValue.imageType,
    title: currentAgentTitle ?? undefined,
  });
  const { loading: copyLoading, onCopy } = useImgToClipboard();

  const widthModeOptions = [
    { key: WidthMode.Wide, label: t('shareModal.widthMode.wide') },
    { key: WidthMode.Narrow, label: t('shareModal.widthMode.narrow') },
  ];

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
      label: t('shareModal.withSystemRole'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'withSystemRole',
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
        <Preview context={context} messages={dbMessages} title={title} {...fieldValue} />
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

export default ShareImage;
