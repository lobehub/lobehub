import { isRecord } from '@lobechat/utils/object';

import type { AskUserBridge, InterventionAnswer } from '../askUser/AskUserBridge';
import type { AgentPromptInput } from '../protocol';
import type { AcpAgentSessionOptions } from './acpAgentSession';
import { ACP_PROTOCOL_VERSION, AcpAgentSession } from './acpAgentSession';
import type { AcpRpcMessage } from './acpStdioClient';
import { AcpRpcResponseError, AcpServerRequestError } from './acpStdioClient';

const AUTH_METHOD = 'cursor_login';
const TRANSPORT = 'cursor-acp' as const;

export interface CursorAcpTextPromptBlock {
  text: string;
  type: 'text';
}

interface CursorAcpInitializeResult {
  agentCapabilities?: { loadSession?: boolean };
  authMethods?: Array<{ id?: string }>;
  protocolVersion?: number | string;
}

interface CursorAcpSessionResult {
  sessionId?: string;
}

interface CursorAcpPromptResult {
  stopReason?: string;
}

interface CursorAcpPermissionOption {
  kind: string;
  name: string;
  optionId: string;
}

interface CursorAcpPermissionRequest {
  options: CursorAcpPermissionOption[];
  toolCall: {
    title: string;
    toolCallId: string;
  };
}

interface CursorQuestionOption {
  id: string;
  label: string;
}

interface CursorQuestion {
  allowMultiple?: boolean;
  id: string;
  options: CursorQuestionOption[];
  prompt: string;
}

interface CursorAskQuestionRequest {
  questions: CursorQuestion[];
  title?: string;
  toolCallId: string;
}

interface CursorCreatePlanRequest {
  name?: string;
  overview?: string;
  plan: string;
  toolCallId: string;
}

interface CursorBridgeOption {
  id: string;
  label: string;
}

interface CanonicalAskQuestionArgs {
  questions: Array<{
    header: string;
    multiSelect: boolean;
    options: Array<{ label: string }>;
    question: string;
  }>;
}

export interface CursorAcpSessionOptions extends AcpAgentSessionOptions {
  askUserBridge?: AskUserBridge;
  prompt: CursorAcpTextPromptBlock[];
}

export const buildCursorAcpArgs = (extraArgs: string[] = []): string[] => [...extraArgs, 'acp'];

/** Cursor ACP currently accepts the same text-only prompt surface as its former print mode. */
export const buildCursorAcpPrompt = (prompt: AgentPromptInput): CursorAcpTextPromptBlock[] => {
  if (typeof prompt === 'string') return prompt ? [{ text: prompt, type: 'text' }] : [];

  return prompt.map((block) => {
    if (block.type === 'image') throw new Error('Cursor CLI does not support image input.');
    return { text: block.text, type: 'text' };
  });
};

export const normalizeCursorQuestion = (
  request: CursorAskQuestionRequest,
): CanonicalAskQuestionArgs => ({
  questions: request.questions.map((question) => ({
    header: request.title ?? '',
    multiSelect: question.allowMultiple === true,
    options: question.options.map(({ label }) => ({ label })),
    question: question.prompt,
  })),
});

export const isCursorAcpSessionNotFoundError = (error: unknown): error is AcpRpcResponseError =>
  error instanceof AcpRpcResponseError &&
  error.method === 'session/load' &&
  error.rpcError.code === -32_602 &&
  typeof error.rpcError.message === 'string' &&
  /^Session "[^"]+" not found$/.test(error.rpcError.message);

/** Cursor's ACP v1 lifecycle (auth + AskUserBridge reverse requests) on the shared session base. */
export class CursorAcpSession extends AcpAgentSession<
  CursorAcpInitializeResult,
  CursorAcpSessionOptions
> {
  private acceptUpdates = false;

  constructor(options: CursorAcpSessionOptions) {
    super(options, {
      args: buildCursorAcpArgs(options.args),
      pipeline: { agentType: 'cursor-acp', cwd: options.cwd },
      processLabel: 'Cursor ACP',
      transport: TRANSPORT,
    });
  }

  get sessionId(): string | undefined {
    return this.acpSessionId;
  }

  protected buildInitializeParams(): unknown {
    return {
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: {
        name: 'lobehub',
        title: 'LobeHub',
        version: this.options.clientVersion,
      },
      protocolVersion: ACP_PROTOCOL_VERSION,
    };
  }

  protected validateInitialized(initialized: CursorAcpInitializeResult): void {
    if (
      initialized.protocolVersion !== ACP_PROTOCOL_VERSION &&
      initialized.protocolVersion !== String(ACP_PROTOCOL_VERSION)
    ) {
      throw new Error(
        `Cursor ACP returned unsupported protocol version: ${String(initialized.protocolVersion)}`,
      );
    }
  }

  protected async establishSession(initialized: CursorAcpInitializeResult): Promise<string> {
    const advertisedAuthMethods = initialized.authMethods?.flatMap(({ id }) =>
      typeof id === 'string' ? [id] : [],
    );
    if (advertisedAuthMethods?.length && !advertisedAuthMethods.includes(AUTH_METHOD)) {
      throw new Error('Cursor could not authenticate. Run `agent login`, then retry.');
    }
    if (advertisedAuthMethods?.includes(AUTH_METHOD)) {
      await this.client.request('authenticate', { methodId: AUTH_METHOD });
    }
    if (this.options.resumeSessionId && initialized.agentCapabilities?.loadSession !== true) {
      throw new Error('Cursor ACP does not support loading this saved session');
    }

    const sessionResult = await this.client.request<CursorAcpSessionResult>(
      this.options.resumeSessionId ? 'session/load' : 'session/new',
      {
        cwd: this.options.cwd,
        mcpServers: [],
        ...(this.options.resumeSessionId ? { sessionId: this.options.resumeSessionId } : {}),
      },
    );
    const sessionId = sessionResult.sessionId ?? this.options.resumeSessionId;
    if (!sessionId) throw new Error('Cursor ACP returned no session id');
    this.options.onSessionId(sessionId);
    await this.pushToPipeline({ sessionId, type: 'cursor_session' });
    return sessionId;
  }

  protected onBeforePrompt(): void {
    // session/load may replay historical updates before returning. Keep setup
    // notifications gated until the new prompt is about to start.
    this.acceptUpdates = true;
  }

  protected buildPromptParams(sessionId: string): unknown {
    return { prompt: this.options.prompt, sessionId };
  }

  protected override async settlePrompt(result: unknown): Promise<void> {
    await this.client.drain();
    await this.pushToPipeline({
      stopReason: (result as CursorAcpPromptResult | undefined)?.stopReason,
      type: 'cursor_prompt_completed',
    });
  }

  protected async onRunFailure(error: Error): Promise<void> {
    await this.pushToPipeline({ message: error.message, type: 'cursor_error' });
    await this.emitEvents(await this.pipeline.flush());
  }

  protected async handleAgentMessage(message: AcpRpcMessage): Promise<void> {
    if (!this.acceptUpdates || message.method !== 'session/update') return;
    const params = isRecord(message.params) ? message.params : undefined;
    if (!isRecord(params?.update)) return;
    await this.pushToPipeline(this.normalizeSessionUpdate(params.update));
  }

  protected async handleServerRequest(message: AcpRpcMessage): Promise<unknown> {
    if (message.method === 'session/request_permission') {
      const request = this.parsePermissionRequest(message.params);
      const selected = await this.selectBridgeOption({
        header: 'Permission required',
        options: request.options.map(({ name, optionId }) => ({ id: optionId, label: name })),
        question: request.toolCall.title,
        toolCallId: this.buildInterventionToolCallId(
          message,
          'permission',
          request.toolCall.toolCallId,
        ),
      });
      return {
        outcome: selected
          ? { optionId: selected.id, outcome: 'selected' }
          : { outcome: 'cancelled' },
      };
    }

    if (message.method === 'cursor/ask_question') {
      const request = this.parseAskQuestionRequest(message.params);
      const args = normalizeCursorQuestion(request);
      // Cursor normally emits a matching tool_call update, but synthesize the
      // canonical call as well so the intervention never races a missing or
      // delayed update. The adapter deduplicates by toolCallId.
      await this.pushToPipeline({
        identifier: 'claude-code',
        rawInput: args,
        sessionUpdate: 'tool_call',
        title: 'askUserQuestion',
        toolCallId: request.toolCallId,
      });

      if (!this.options.askUserBridge) return { outcome: { outcome: 'cancelled' } };
      const answer = await this.options.askUserBridge.pending({
        arguments: args,
        toolCallId: request.toolCallId,
      });
      return this.buildQuestionResponse(request, answer);
    }

    if (message.method === 'cursor/create_plan') {
      const request = this.parseCreatePlanRequest(message.params);
      const question = [request.overview, request.plan].filter(Boolean).join('\n\n');
      const selected = await this.selectBridgeOption({
        header: request.name ?? 'Plan approval',
        options: [
          { id: 'accepted', label: 'Accept' },
          { id: 'rejected', label: 'Reject' },
        ],
        question,
        toolCallId: this.buildInterventionToolCallId(message, 'plan', request.toolCallId),
      });
      return {
        outcome: {
          outcome:
            selected?.id === 'accepted'
              ? 'accepted'
              : selected?.id === 'rejected'
                ? 'rejected'
                : 'cancelled',
        },
      };
    }

    throw new AcpServerRequestError(-32_601, `Unsupported ACP client request: ${message.method}`);
  }

  private normalizeSessionUpdate(update: Record<string, unknown>): Record<string, unknown> {
    if (
      update.sessionUpdate !== 'tool_call' ||
      typeof update.toolCallId !== 'string' ||
      !isRecord(update.rawInput)
    ) {
      return update;
    }

    try {
      const request = this.parseAskQuestionRequest({
        ...update.rawInput,
        toolCallId: update.toolCallId,
      });
      return {
        ...update,
        identifier: 'claude-code',
        rawInput: normalizeCursorQuestion(request),
        title: 'askUserQuestion',
      };
    } catch {
      return update;
    }
  }

  private parsePermissionRequest(value: unknown): CursorAcpPermissionRequest {
    if (!isRecord(value) || !Array.isArray(value.options) || !isRecord(value.toolCall)) {
      throw new AcpServerRequestError(-32_602, 'Invalid session/request_permission request');
    }

    const options = value.options.flatMap((option) => {
      if (
        !isRecord(option) ||
        typeof option.kind !== 'string' ||
        typeof option.name !== 'string' ||
        typeof option.optionId !== 'string'
      ) {
        return [];
      }
      return [{ kind: option.kind, name: option.name, optionId: option.optionId }];
    });
    if (
      options.length !== value.options.length ||
      options.length === 0 ||
      typeof value.toolCall.toolCallId !== 'string' ||
      typeof value.toolCall.title !== 'string'
    ) {
      throw new AcpServerRequestError(-32_602, 'Invalid session/request_permission options');
    }

    return {
      options,
      toolCall: {
        title: value.toolCall.title,
        toolCallId: value.toolCall.toolCallId,
      },
    };
  }

  private parseCreatePlanRequest(value: unknown): CursorCreatePlanRequest {
    if (
      !isRecord(value) ||
      typeof value.toolCallId !== 'string' ||
      typeof value.plan !== 'string'
    ) {
      throw new AcpServerRequestError(-32_602, 'Invalid cursor/create_plan request');
    }

    return {
      name: typeof value.name === 'string' ? value.name : undefined,
      overview: typeof value.overview === 'string' ? value.overview : undefined,
      plan: value.plan,
      toolCallId: value.toolCallId,
    };
  }

  private async selectBridgeOption({
    header,
    options,
    question,
    toolCallId,
  }: {
    header: string;
    options: CursorBridgeOption[];
    question: string;
    toolCallId: string;
  }): Promise<CursorBridgeOption | undefined> {
    if (!this.options.askUserBridge) return;

    const arguments_ = {
      questions: [
        {
          header,
          multiSelect: false,
          options: options.map(({ label }) => ({ label })),
          question,
        },
      ],
    } satisfies CanonicalAskQuestionArgs;
    await this.pushToPipeline({
      identifier: 'claude-code',
      rawInput: arguments_,
      sessionUpdate: 'tool_call',
      title: 'askUserQuestion',
      toolCallId,
    });
    const answer = await this.options.askUserBridge.pending({
      arguments: arguments_,
      toolCallId,
    });
    await this.pushToPipeline({
      rawOutput: answer,
      sessionUpdate: 'tool_call_update',
      status: 'completed',
      toolCallId,
    });
    const selections = this.getAnswerSelections(answer, question);
    return options.find(({ id, label }) => selections.includes(id) || selections.includes(label));
  }

  private buildInterventionToolCallId(
    message: AcpRpcMessage,
    kind: 'permission' | 'plan',
    sourceToolCallId: string,
  ): string {
    return `cursor-${kind}-${String(message.id)}-${sourceToolCallId}`;
  }

  private getAnswerSelections(answer: InterventionAnswer, question: string): string[] {
    if (answer.cancelled || !isRecord(answer.result)) return [];
    const rawSelection = answer.result[question];
    return (Array.isArray(rawSelection) ? rawSelection : [rawSelection]).flatMap((selection) =>
      typeof selection === 'string' ? [selection] : [],
    );
  }

  private parseAskQuestionRequest(value: unknown): CursorAskQuestionRequest {
    if (
      !isRecord(value) ||
      typeof value.toolCallId !== 'string' ||
      !Array.isArray(value.questions)
    ) {
      throw new AcpServerRequestError(-32_602, 'Invalid cursor/ask_question request');
    }

    const questions = value.questions.flatMap((questionValue) => {
      if (!isRecord(questionValue)) return [];
      if (
        typeof questionValue.id !== 'string' ||
        typeof questionValue.prompt !== 'string' ||
        !Array.isArray(questionValue.options)
      ) {
        return [];
      }
      const options = questionValue.options.flatMap((optionValue) =>
        isRecord(optionValue) &&
        typeof optionValue.id === 'string' &&
        typeof optionValue.label === 'string'
          ? [{ id: optionValue.id, label: optionValue.label }]
          : [],
      );
      if (options.length === 0) return [];
      return [
        {
          allowMultiple: questionValue.allowMultiple === true,
          id: questionValue.id,
          options,
          prompt: questionValue.prompt,
        },
      ];
    });
    if (questions.length !== value.questions.length || questions.length === 0) {
      throw new AcpServerRequestError(-32_602, 'Invalid cursor/ask_question questions');
    }

    return {
      questions,
      title: typeof value.title === 'string' ? value.title : undefined,
      toolCallId: value.toolCallId,
    };
  }

  private buildQuestionResponse(
    request: CursorAskQuestionRequest,
    answer: InterventionAnswer,
  ): unknown {
    if (answer.cancelled) return { outcome: { outcome: 'cancelled' } };
    if (!isRecord(answer.result)) return { outcome: { outcome: 'cancelled' } };

    const freeform = answer.result.__freeform__;
    if (typeof freeform === 'string' && freeform.trim()) {
      return {
        outcome: {
          answers: request.questions.map(({ id }) => ({
            questionId: id,
            selectedOptionIds: [freeform.trim()],
          })),
          outcome: 'answered',
        },
      };
    }

    const answers = [];
    const supplement = answer.result.__supplement__;
    const supplementText = typeof supplement === 'string' ? supplement.trim() : '';
    for (const question of request.questions) {
      const selectedOptionIds = this.getAnswerSelections(answer, question.prompt).flatMap(
        (selection) => {
          const option = question.options.find(
            ({ id, label }) => id === selection || label === selection,
          );
          return [option?.id ?? selection];
        },
      );
      answers.push({
        questionId: question.id,
        selectedOptionIds: supplementText
          ? [...selectedOptionIds, supplementText]
          : selectedOptionIds,
      });
    }

    return { outcome: { answers, outcome: 'answered' } };
  }
}
