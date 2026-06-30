'use client';

import { Alert } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCurrentModelNotice } from './useCurrentModelNotice';

const styles = createStaticStyles(({ css }) => ({
  alert: css`
    .ant-alert-message {
      font-size: 12px;
      line-height: 18px !important;
    }

    .ant-alert-icon {
      height: 18px !important;
    }
  `,
}));

const CurrentModelNotice = memo(() => {
  const { t } = useTranslation('chat');
  const noticeKey = useCurrentModelNotice();

  if (!noticeKey) return null;

  return (
    <Alert
      classNames={{ alert: cx(styles.alert) }}
      style={{ fontSize: 12 }}
      title={t(noticeKey)}
      type={'warning'}
      variant={'borderless'}
    />
  );
});

CurrentModelNotice.displayName = 'CurrentModelNotice';

export default CurrentModelNotice;
