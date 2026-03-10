'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Center, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { MessageSquareHeart } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import GuideModal from '@/components/GuideModal';
import GuideVideo from '@/components/GuideVideo';
import { GITHUB, GITHUB_ISSUES } from '@/const/url';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { isOnServerSide } from '@/utils/env';

const styles = createStaticStyles(
  ({ css, cssVar }) => css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
);

export const LayoutSettingsFooterClassName = 'settings-layout-footer';

const Footer = memo<PropsWithChildren>(() => {
  const { t } = useTranslation('common');
  const [openStar, setOpenStar] = useState(false);
  const [openFeedback, setOpenFeedback] = useState(false);

  const { hideGitHub } = useServerConfigStore(featureFlagsSelectors);

  return hideGitHub ? null : (
    <>
      <Flexbox className={LayoutSettingsFooterClassName} justify={'flex-end'}>
        <Center
          horizontal
          as={'footer'}
          className={styles}
          flex={'none'}
          padding={16}
          width={'100%'}
        >
          <div style={{ textAlign: 'center' }}>
            <Icon icon={MessageSquareHeart} /> {`${t('footer.title')} `}
            <a
              aria-label={'star'}
              href={GITHUB}
              onClick={(e) => {
                e.preventDefault();
                setOpenStar(true);
              }}
            >
              {t('footer.action.star')}
            </a>
            {` ${t('footer.and')} `}
            <a
              aria-label={'feedback'}
              href={GITHUB_ISSUES}
              onClick={(e) => {
                e.preventDefault();
                setOpenFeedback(true);
              }}
            >
              {t('footer.action.feedback')}
            </a>
            {' !'}
          </div>
        </Center>
      </Flexbox>
      <GuideModal
        cancelText={t('footer.later')}
        desc={t('footer.star.desc')}
        okText={t('footer.star.action')}
        open={openStar}
        title={t('footer.star.title')}
        cover={
          <GuideVideo
            height={269}
            src={`https://hub-apac-1.lobeobjects.space/assets/star.mp4`}
            width={358}
          />
        }
        onCancel={() => setOpenStar(false)}
        onOk={() => {
          if (isOnServerSide) return;
          window.open(GITHUB, '__blank');
        }}
      />
      <GuideModal
        cancelText={t('footer.later')}
        desc={t('footer.feedback.desc', { appName: BRANDING_NAME })}
        okText={t('footer.feedback.action')}
        open={openFeedback}
        title={t('footer.feedback.title')}
        cover={
          <GuideVideo
            height={269}
            src={'<@985522149420855317> https://hub-apac-1.lobeobjects.space/assets/feedback.mp4'}
            width={358}
          />
        }
        onCancel={() => setOpenFeedback(false)}
        onOk={() => {
          if (isOnServerSide) return;
          window.open(GITHUB_ISSUES, '__blank');
        }}
      />
    </>
  );
});

Footer.displayName = 'SettingFooter';

export default Footer;
