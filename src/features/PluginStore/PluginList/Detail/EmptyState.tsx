import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Puzzle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
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

const EmptyState = memo(() => {
  const { t } = useTranslation('plugin');

  return (
    <Center className={styles.container}>
      <Flexbox align="center">
        <div className={styles.iconWrapper}>
          <Icon icon={Puzzle} size={32} />
        </div>
        <Text className={styles.title}>{t('detailModal.emptyState.title')}</Text>
        <Text className={styles.description}>{t('detailModal.emptyState.description')}</Text>
      </Flexbox>
    </Center>
  );
});

export default EmptyState;
