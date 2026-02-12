'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Avatar, Button, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { LucideArrowUpRightFromSquare, TelescopeIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Notification from '@/components/Notification';
import { PRIVACY_URL } from '@/const/url';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  desc: css`
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    font-size: 18px;
    font-weight: bold;
  `,
}));

const TelemetryNotification = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('common');
  const isPreferenceInit = useUserStore(preferenceSelectors.isPreferenceInit);

  const [useCheckTrace, updatePreference] = useUserStore((s) => [
    s.useCheckTrace,
    s.updatePreference,
  ]);

  const { data: showModal, mutate } = useCheckTrace(isPreferenceInit);

  const updateTelemetry = (telemetry: boolean) => {
    updatePreference({ telemetry });
    mutate();
  };

  return (
    <Notification mobile={mobile} show={showModal} showCloseIcon={false}>
      <Flexbox>
        <Avatar
          avatar={<TelescopeIcon />}
          background={cssVar.geekblue1}
          style={{ color: cssVar.geekblue7 }}
        />
      </Flexbox>
      <Flexbox gap={16}>
        <Flexbox gap={12}>
          <Flexbox className={styles.title}>
            {t('telemetry.title', { appName: BRANDING_NAME })}
          </Flexbox>
          <div className={styles.desc}>
            {t('telemetry.desc', { appName: BRANDING_NAME })}
            <span>
              <a href={PRIVACY_URL} rel="noreferrer" target="_blank">
                {t('telemetry.learnMore')}
                <Icon icon={LucideArrowUpRightFromSquare} style={{ marginInlineStart: 4 }} />
              </a>
            </span>
          </div>
        </Flexbox>
        <Flexbox horizontal gap={8}>
          <Button
            type={'primary'}
            onClick={() => {
              updateTelemetry(true);
            }}
          >
            {t('telemetry.allow')}
          </Button>
          <Button
            type={'text'}
            onClick={() => {
              updateTelemetry(false);
            }}
          >
            {t('telemetry.deny')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Notification>
  );
});

export default TelemetryNotification;
