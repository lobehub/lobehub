import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import { contextSelectors, useConversationStore } from '../../../store';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-block: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const InterruptedHint = memo(() => {
  const { t } = useTranslation('chat');
  const context = useConversationStore(contextSelectors.context);
  const handingOff = useChatStore(operationSelectors.isSteerHandoffPending(context));

  if (handingOff) return null;

  return (
    <div className={styles.container}>
      {t('messageAction.interrupted')} · {t('messageAction.interruptedHint')}
    </div>
  );
});

InterruptedHint.displayName = 'InterruptedHint';

export default InterruptedHint;
