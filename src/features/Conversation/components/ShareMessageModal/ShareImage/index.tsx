import { UIChatMessage } from '@lobechat/types';
import { Button, Form, type FormItemProps, Segmented } from '@lobehub/ui';
import { Switch } from 'antd';
import { CopyIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { FORM_STYLE } from '@/const/layoutTokens';
import { useImgToClipboard } from '@/hooks/useImgToClipboard';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ImageType, imageTypeOptions, useScreenshot } from '@/hooks/useScreenshot';
import { useSessionStore } from '@/store/session';
import { sessionMetaSelectors } from '@/store/session/selectors';

import { useStyles } from '../style';
import Preview from './Preview';
import { FieldType } from './type';

const DEFAULT_FIELD_VALUE: FieldType = {
  imageType: ImageType.JPG,
  withBackground: true,
  withFooter: true,
};

const ShareImage = memo<{ message: UIChatMessage; mobile?: boolean; uniqueId?: string }>(
  ({ message, uniqueId }) => {
    const currentAgentTitle = useSessionStore(sessionMetaSelectors.currentAgentTitle);
    const [fieldValue, setFieldValue] = useState<FieldType>(DEFAULT_FIELD_VALUE);
    const { t } = useTranslation(['chat', 'common']);
    const { styles } = useStyles();

    // 生成唯一的预览ID，避免DOM冲突
    const previewId = uniqueId ? `preview-${uniqueId}` : 'preview';

    const { loading, onDownload, title } = useScreenshot({
      id: `#${previewId}`,
      imageType: fieldValue.imageType,
      title: currentAgentTitle,
    });
    const { loading: copyLoading, onCopy } = useImgToClipboard({ id: `#${previewId}` });
    const settings: FormItemProps[] = [
      {
        children: <Switch />,
        label: t('shareModal.withBackground'),
        layout: 'horizontal',
        minWidth: undefined,
        name: 'withBackground',
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
          onClick={() => onCopy()}
          size={isMobile ? undefined : 'large'}
          type={'primary'}
        >
          {t('copy', { ns: 'common' })}
        </Button>
        <Button block loading={loading} onClick={onDownload} size={isMobile ? undefined : 'large'}>
          {t('shareModal.download')}
        </Button>
      </>
    );

    return (
      <>
        <Flexbox className={styles.body} gap={16} horizontal={!isMobile}>
          <Preview title={title} {...fieldValue} message={message} previewId={previewId} />
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
  },
);

export default ShareImage;
