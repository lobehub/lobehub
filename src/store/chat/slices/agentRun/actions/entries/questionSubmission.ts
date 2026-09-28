import type { ConversationContext, UIChatMessage } from '@lobechat/types';

import type { AgentInterventionSourceAction } from '@/services/aiAgent';
import { messageService } from '@/services/message';
import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';
import type { ChatStore } from '@/store/chat/store';
import type { StoreSetter } from '@/store/types';

import type { QuestionSubmissionPhase } from '../../initialState';

export class QuestionSubmissionActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: StoreSetter<ChatStore>;

  constructor(set: StoreSetter<ChatStore>, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  #setPhase = (id: string, phase?: QuestionSubmissionPhase) => {
    this.#set((state) => {
      const questionSubmissions = { ...state.questionSubmissions };
      if (phase) questionSubmissions[id] = phase;
      else delete questionSubmissions[id];
      return { questionSubmissions };
    });
  };

  #applyResolution = (message: UIChatMessage, context: ConversationContext) => {
    const { content, pluginIntervention, pluginState } = message;
    const dispatchContext = { context };
    this.#get().internal_dispatchMessage(
      {
        id: message.id,
        type: 'updateMessage',
        value: { content, pluginIntervention, pluginState },
      },
      dispatchContext,
    );
    if (message.parentId && message.tool_call_id) {
      this.#get().internal_dispatchMessage(
        {
          id: message.parentId,
          tool_call_id: message.tool_call_id,
          type: 'updateMessageTools',
          value: { intervention: pluginIntervention },
        },
        dispatchContext,
      );
    }
  };

  /** Reconcile only this tool row: a late read must not overwrite streamed assistant content. */
  checkQuestionSubmission = async (id: string, context: ConversationContext): Promise<boolean> => {
    if (this.#get().questionSubmissions[id] === 'checking') return false;
    this.#setPhase(id, 'checking');
    try {
      const messages = await messageService.getMessages({ ...context, skipWorks: true });
      const message = messages.find((item) => item.id === id);
      if (!message?.pluginIntervention) throw new Error('Question resolution is unavailable');
      if (message.pluginIntervention.status === 'pending') {
        // An event may have confirmed the answer while this read was in flight.
        const current = dbMessageSelectors.getDbMessageById(id)(this.#get());
        if (current?.pluginIntervention && current.pluginIntervention.status !== 'pending') {
          this.#setPhase(id);
          return true;
        }
        this.#setPhase(id, 'failed');
        return false;
      }
      this.#applyResolution(message, context);
      this.#setPhase(id);
      return true;
    } catch (error) {
      console.error('[QuestionSubmission] Failed to check resolution:', error);
      this.#setPhase(id, 'uncertain');
      return false;
    }
  };

  /** The form can collapse immediately without writing to the server-owned pending row. */
  runQuestionSubmission = async (
    id: string,
    context: ConversationContext,
    submit: () => Promise<void>,
  ): Promise<void> => {
    const phase = this.#get().questionSubmissions[id];
    if (phase && phase !== 'failed') return;
    this.#setPhase(id, 'submitting');
    try {
      await submit();
    } catch (error) {
      const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
      if (message?.pluginIntervention && message.pluginIntervention.status !== 'pending') {
        // The answer was accepted; a continuation failure must not reopen it.
        this.#setPhase(id);
        throw error;
      }
      if (await this.checkQuestionSubmission(id, context)) return;
      throw error;
    }
    const resultPhase = this.#get().questionSubmissions[id];
    if (resultPhase === 'failed' || resultPhase === 'uncertain') {
      throw new Error('Question submission could not be confirmed');
    }
    this.#setPhase(id);
  };

  /** Apply only a confirmed built-in question claim; heterogeneous producer ACKs stay separate. */
  internal_confirmQuestionSubmission = (
    id: string,
    action: AgentInterventionSourceAction,
    context: ConversationContext,
  ): void => {
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
    if (
      message?.plugin?.apiName !== 'askUserQuestion' ||
      !['lobe-agent', 'lobe-user-interaction'].includes(message.plugin.identifier) ||
      (action.type !== 'submit_answers' && action.type !== 'skip_interaction')
    )
      return;

    const skipped = action.type === 'skip_interaction';
    this.#applyResolution(
      {
        ...message,
        content: skipped
          ? 'User skipped this question.'
          : `User submitted: ${JSON.stringify(action.result)}`,
        pluginIntervention: {
          ...message.pluginIntervention,
          resolving: false,
          ...(skipped ? { skipped: true } : {}),
          status: skipped ? 'rejected' : 'approved',
        },
        pluginState: skipped
          ? message.pluginState
          : { ...message.pluginState, askUserAnswers: action.result },
      },
      context,
    );
    // Authoritative events / ordinary message revalidation reconcile the result.
    // Do not put a second network round trip on the continuation's critical path.
    void this.#get()
      .refreshMessages(context)
      .catch((error) => {
        console.error('[QuestionSubmission] Background revalidation failed:', error);
      });
  };
}

export type QuestionSubmissionAction = Pick<
  QuestionSubmissionActionImpl,
  keyof QuestionSubmissionActionImpl
>;
