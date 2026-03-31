'use client';

import { UTM_SOURCE } from '@lobechat/business-const';
import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Database, FileImage, Network, Sparkles } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import FeatureList from '@/components/FeatureList';
import { DATABASE_SELF_HOSTING_URL, OFFICIAL_URL } from '@/const/url';

const BLOCK_SIZE = 100;
const ICON_SIZE = { size: 72, strokeWidth: 1.5 };

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionTitle: css`
    margin-block-start: 12px;
    font-size: 16px;
    color: ${cssVar.colorTextSecondary};
  `,
  card: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;

    width: 200px;
    height: 140px;
    border-radius: ${cssVar.borderRadiusLG}px;

    font-weight: 500;
    text-align: center;

    background: ${cssVar.colorFillTertiary};
    box-shadow: 0 0 0 1px ${cssVar.colorFillTertiary} inset;

    transition: background 0.3s ease-in-out;

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  glow: css`
    position: absolute;
    inset-block-end: -12px;
    inset-inline-end: 0;

    width: 48px;
    height: 48px;

    opacity: 0.5;
    filter: blur(24px);
  `,

  icon: css`
    border-radius: ${cssVar.borderRadiusLG}px;
    color: ${cssVar.colorTextLightSolid};
  `,
  iconGroup: css`
    margin-block-start: -44px;
  `,
}));

const NotSupportClient = () => {
  const { t } = useTranslation('image');

  const features = [
    {
      avatar: Network,
      desc: t('notSupportGuide.features.multiProviders.desc'),
      title: t('notSupportGuide.features.multiProviders.title'),
    },
    {
      avatar: Database,
      desc: t('notSupportGuide.features.fileIntegration.desc'),
      title: t('notSupportGuide.features.fileIntegration.title'),
    },
    {
      avatar: Sparkles,
      desc: t('notSupportGuide.features.llmAssisted.desc'),
      title: t('notSupportGuide.features.llmAssisted.title'),
    },
  ];

  return (
    <Center gap={40} height={'100%'} width={'100%'}>
      <Flexbox horizontal className={styles.iconGroup} gap={12}>
        <Center
          className={styles.icon}
          height={BLOCK_SIZE * 1.25}
          width={BLOCK_SIZE}
          style={{
            background: cssVar.purple,
            transform: 'rotateZ(-20deg) translateX(10px)',
          }}
        >
          <Icon icon={FileImage} size={ICON_SIZE} />
        </Center>
        <Center
          className={styles.icon}
          height={BLOCK_SIZE * 1.25}
          width={BLOCK_SIZE}
          style={{
            background: cssVar.gold,
            transform: 'translateY(-22px)',
            zIndex: 1,
          }}
        >
          <Icon icon={Sparkles} size={ICON_SIZE} />
        </Center>
        <Center
          className={styles.icon}
          height={BLOCK_SIZE * 1.25}
          width={BLOCK_SIZE}
          style={{
            background: cssVar.geekblue,
            transform: 'rotateZ(20deg) translateX(-10px)',
          }}
        >
          <Icon icon={Network} size={ICON_SIZE} />
        </Center>
      </Flexbox>

      <Flexbox justify={'center'} style={{ textAlign: 'center' }}>
        <Text strong fontSize={18}>
          {t('notSupportGuide.title')}
        </Text>
        <Text type={'secondary'}>
          <Trans
            i18nKey={'notSupportGuide.desc'}
            ns={'image'}
            components={[
              <span key="0" />,
              <a href={DATABASE_SELF_HOSTING_URL} key="1" rel="noreferrer" target="_blank" />,
              <span key="2" />,
              <a
                href={`${OFFICIAL_URL}?utm_source=${UTM_SOURCE}&utm_medium=client_not_support_image`}
                key="3"
                rel="noreferrer"
                target="_blank"
              />,
            ]}
          />
        </Text>
      </Flexbox>

      <Flexbox style={{ marginTop: 40 }}>
        <FeatureList data={features} />
      </Flexbox>
    </Center>
  );
};

export default NotSupportClient;
