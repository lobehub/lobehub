'use client';

import { Alert } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useSelectExecutionTarget } from '@/features/ChatInput/hooks/useSelectExecutionTarget';

import { useChatInputNotice } from './useChatInputNotice';

const styles = createStaticStyles(({ css }) => ({
  alert: css`
    /* @lobehub/ui's root style sets align-items: flex-start, top-aligning the
     * action button against the (shorter) icon+text row instead of centering
     * it. */
    align-items: center !important;

    /* Antd's alert section defaults to flex: 1, stretching to fill all
     * leftover width and pushing the action button to the far edge. Shrink
     * it to content so the action sits right next to the message. */
    .ant-alert-section {
      flex: 0 1 auto !important;
    }

    /* The rendered title class is .ant-alert-title (not .ant-alert-message,
     * which this version of antd no longer emits) — matching line-height to
     * the icon's forced height keeps them vertically aligned. */
    .ant-alert-title {
      font-size: 12px;
      line-height: 18px !important;
    }

    .ant-alert-icon {
      height: 18px !important;
    }
  `,
}));

const SwitchToLocalAction = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const selectExecutionTarget = useSelectExecutionTarget(agentId);
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      await selectExecutionTarget('local');
    } finally {
      // The notice unmounts once the target switches; guard in case it doesn't
      // (e.g. a hetero agent with no resolvable local device).
      setLoading(false);
    }
  };

  return (
    <Button loading={loading} size={'small'} type={'primary'} onClick={handleClick}>
      {t('input.switchToLocal')}
    </Button>
  );
});

SwitchToLocalAction.displayName = 'SwitchToLocalAction';

const ChatInputNotice = memo(() => {
  const { t } = useTranslation('chat');
  const notice = useChatInputNotice();

  if (!notice) return null;

  return (
    <Alert
      action={notice.action === 'switchToLocal' ? <SwitchToLocalAction /> : undefined}
      classNames={{ alert: cx(styles.alert) }}
      style={{ fontSize: 12 }}
      title={t(notice.key)}
      type={notice.type}
      variant={'borderless'}
    />
  );
});

ChatInputNotice.displayName = 'ChatInputNotice';

export default ChatInputNotice;
