'use client';

import { Button, Flexbox, toast } from '@lobehub/ui';
import { ListChecks } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation/store';
import { useChatStore } from '@/store/chat';
import {
  dismissCodexPlan,
  executeCodexPlan,
  shouldShowCodexPlanDecision,
} from '@/store/chat/heteroPlanMode';
import { operationSelectors, topicSelectors } from '@/store/chat/selectors';

interface ProposedPlanDecisionProps {
  messageId: string;
  toolCallId?: string;
}

/**
 * "Execute plan / Keep discussing" under the latest Codex plan. Codex's plan
 * turn already ended, so these only decide what the next message is:
 * executing turns Plan off and asks Codex to carry the plan out; discussing
 * just puts the buttons away (Plan stays on).
 */
const ProposedPlanDecision = ({ toolCallId }: ProposedPlanDecisionProps) => {
  const { t } = useTranslation('plugin');
  const [context, messages, sendMessage] = useConversationStore((s) => [
    s.context,
    s.dbMessages,
    s.sendMessage,
  ]);
  const topicId = context.topicId;
  const metadata = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.metadata : undefined,
  );
  const liveRun = useChatStore(operationSelectors.isAgentRuntimeRunningByContext(context));
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);
  const [busy, setBusy] = useState<'discuss' | 'execute'>();

  if (
    !topicId ||
    !shouldShowCodexPlanDecision({
      messages,
      metadata,
      running: liveRun || !!metadata?.runningOperation,
      toolCallId,
    })
  ) {
    return null;
  }
  const deps = { toolCallId: toolCallId!, topicId, updateTopicMetadata };

  const execute = async () => {
    setBusy('execute');
    try {
      await executeCodexPlan({
        ...deps,
        message: t('builtins.codex.proposedPlan.executeMessage'),
        sendMessage,
      });
    } catch (error) {
      console.error('[ProposedPlanDecision] execute failed', error);
      toast.error(t('builtins.codex.proposedPlan.failed'));
    } finally {
      setBusy(undefined);
    }
  };

  const discuss = async () => {
    setBusy('discuss');
    try {
      await dismissCodexPlan(deps);
    } catch (error) {
      console.error('[ProposedPlanDecision] dismiss failed', error);
      toast.error(t('builtins.codex.proposedPlan.failed'));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Flexbox horizontal data-testid={'codex-plan-decision'} gap={8} paddingBlock={8}>
      <Button
        disabled={!!busy}
        icon={ListChecks}
        loading={busy === 'execute'}
        size={'small'}
        type={'primary'}
        onClick={() => void execute()}
      >
        {t('builtins.codex.proposedPlan.execute')}
      </Button>
      <Button
        disabled={!!busy}
        loading={busy === 'discuss'}
        size={'small'}
        onClick={() => void discuss()}
      >
        {t('builtins.codex.proposedPlan.discuss')}
      </Button>
    </Flexbox>
  );
};

export default ProposedPlanDecision;
