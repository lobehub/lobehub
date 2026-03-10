import { type FormItemProps } from '@lobehub/ui';
import { Button, Flexbox, Form, Segmented } from '@lobehub/ui';
import { Switch } from 'antd';
import { CopyIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useImgToClipboard } from '@/hooks/useImgToClipboard';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ImageType, imageTypeOptions, useScreenshot } from '@/hooks/useScreenshot';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

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
  const currentAgentTitle = useAgentStore(agentSelectors.currentAgentTitle);
  const [fieldValue, setFieldValue] = useState<FieldType>(DEFAULT_FIELD_VALUE);
  const { t } = useTranslation(['chat', 'common']);
  const { loading, onDownload, title } = useScreenshot({
    imageType: fieldValue.imageType,
    title: currentAgentTitle ?? undefined,
  });
  const { loading: copyLoading, onCopy } = useImgToClipboard();

  const widthModeOptions = [
    { label: t('shareModal.widthMode.wide'), value: WidthMode.Wide },
    { label: t('shareModal.widthMode.narrow'), value: WidthMode.Narrow },
  ];

  const settings: FormItemProps[] = [
    {
      children: <Segmented options={widthModeOptions} />,
      label: t('shareModal.widthMode.label'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'widthMode',
    },
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
      label: t('shareModal.withFooter'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'withFooter',
      valuePropName: 'checked',
    },
    {
      children: <Segmented options={imageTypeOptions} />,
      label: t('shareModal.imageType'),
      layout: 'horizontal',
      minWidth: undefined,
      name: 'imageType',
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
        <Preview title={title} {...fieldValue} />
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

export default ShareImage;
