'use client';

import { copyToClipboard, Flexbox } from '@lobehub/ui';
import { Button, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    flex-shrink: 0;

    height: 48px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  logo: css`
    display: flex;
    color: inherit;
  `,
  title: css`
    min-width: 0;
  `,
}));

interface ArtifactShareChromeProps {
  title?: string | null;
}

export const ArtifactShareChrome = ({ title }: ArtifactShareChromeProps) => {
  const { t } = useTranslation('chat');

  const handleShare = async () => {
    await copyToClipboard(window.location.href);
    toast.success(t('shareModal.copyLinkSuccess'));
  };

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.header}
      gap={12}
      justify={'space-between'}
    >
      <Flexbox horizontal align={'center'} flex={1} style={{ minWidth: 0 }}>
        <a className={styles.logo} href={'/'}>
          <ProductLogo size={28} />
        </a>
      </Flexbox>
      <Flexbox flex={2} style={{ minWidth: 0 }}>
        <Text
          ellipsis
          strong
          align={'center'}
          className={styles.title}
          fontSize={14}
          style={{ margin: 0 }}
        >
          {title}
        </Text>
      </Flexbox>
      <Flexbox horizontal align={'center'} flex={1} gap={8} justify={'flex-end'}>
        <Button size={'small'} onClick={handleShare}>
          {t('sharePage.artifact.share')}
        </Button>
        <Button href={'/'} size={'small'} type={'primary'}>
          {t('sharePage.menu.goToLobeHub')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};
