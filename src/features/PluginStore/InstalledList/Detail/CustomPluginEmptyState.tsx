import { Button, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Package } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EditCustomPlugin from '../EditCustomPlugin';

const styles = createStaticStyles(({ css, cssVar }) => ({
  button: css`
    margin-block-start: ${cssVar.marginLG};
  `,
  container: css`
    height: 80%;
    padding-block: ${cssVar.paddingXL};
    padding-inline: ${cssVar.paddingLG};
  `,
  description: css`
    max-width: 240px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  iconWrapper: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 64px;
    height: 64px;
    margin-block-end: ${cssVar.marginMD};
    border-radius: 50%;

    background-color: ${cssVar.colorPrimaryBg};
  `,
  title: css`
    margin-block-end: ${cssVar.marginSM};

    font-size: ${cssVar.fontSizeLG};
    font-weight: 500;
    color: ${cssVar.colorText};
    text-align: center;
  `,
}));

interface Props {
  identifier: string;
}

const CustomPluginEmptyState = memo<Props>(({ identifier }) => {
  const { t } = useTranslation('plugin');

  const [showModal, setModal] = useState(false);

  return (
    <Center className={styles.container}>
      <Flexbox align="center">
        <div className={styles.iconWrapper}>
          <Icon icon={Package} size={32} />
        </div>
        <Text className={styles.title}>{t('detailModal.customPlugin.title')}</Text>
        <Text className={styles.description}>{t('detailModal.customPlugin.description')}</Text>
        <EditCustomPlugin identifier={identifier} onOpenChange={setModal} open={showModal}>
          <Button
            className={styles.button}
            onClick={() => {
              setModal(true);
            }}
            type="primary"
          >
            {t('detailModal.customPlugin.editBtn')}
          </Button>
        </EditCustomPlugin>
      </Flexbox>
    </Center>
  );
});

export default CustomPluginEmptyState;
