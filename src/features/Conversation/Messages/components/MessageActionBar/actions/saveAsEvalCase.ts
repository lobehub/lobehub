import { toast } from '@lobehub/ui/base-ui';
import i18next from 'i18next';
import { FlaskConical } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { buildCaptureDraft, createEvalCaptureModal } from '@/features/EvalCapture';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { dataSelectors, useConversationStoreApi } from '../../../../store';
import { defineAction } from '../defineAction';

/**
 * Capture this turn as an evaluation test case.
 *
 * Sits next to Regenerate because they are the same gesture aimed differently:
 * regenerate re-asks for another sample, this re-asks for another model and
 * keeps the result. Developer-facing, so it is behind a Labs toggle rather than
 * shown to everyone, and absent on anything but an assistant answer — a user
 * turn is the input to a case, not a case.
 */
export const saveAsEvalCaseAction = defineAction({
  key: 'saveAsEvalCase',
  useBuild: (ctx) => {
    const { t } = useTranslation('chat');
    const enabled = useUserStore(labPreferSelectors.enableEvalCapture);
    const navigate = useWorkspaceAwareNavigate();
    // The conversation store is context-scoped, not a global singleton, so an
    // imperative read needs the store api from context.
    const storeApi = useConversationStoreApi();

    return useMemo(() => {
      if (!enabled || ctx.role !== 'assistant') return null;

      return {
        handleClick: async () => {
          // The modal's own chrome is in the `eval` namespace, which the chat
          // route has never loaded — without this its title and buttons render
          // as raw keys.
          await i18next.loadNamespaces('eval');

          const messages = dataSelectors.displayMessages(storeApi.getState());
          const draft = buildCaptureDraft(messages as never, ctx.id);

          if (!draft) {
            toast.error(t('messageAction.saveAsEvalCase.notCapturable'));
            return;
          }

          createEvalCaptureModal({
            draft,
            onView: (testCaseId) => navigate(`/eval/cases/${testCaseId}`),
          });
        },
        icon: FlaskConical,
        key: 'saveAsEvalCase',
        label: t('messageAction.saveAsEvalCase.label'),
      };
    }, [enabled, ctx.role, ctx.id, t, navigate, storeApi]);
  },
});
