import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import { contextSelectors, useConversationStore } from '../../../store';

const styles = stylex.create({
  container: { paddingBlock: '4px', fontSize: '12px', color: cssVar.colorTextTertiary },
});

const InterruptedHint = memo(() => {
  const { t } = useTranslation('chat');
  const context = useConversationStore(contextSelectors.context);
  const handingOff = useChatStore(operationSelectors.isSteerHandoffPending(context));

  if (handingOff) return null;

  return (
    <div {...stylex.props(styles.container)}>
      {t('messageAction.interrupted')} · {t('messageAction.interruptedHint')}
    </div>
  );
});

InterruptedHint.displayName = 'InterruptedHint';

export default InterruptedHint;
