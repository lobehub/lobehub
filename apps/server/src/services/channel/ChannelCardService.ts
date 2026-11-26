import { A2uiApiName, A2uiIdentifier } from '@lobechat/builtin-tool-a2ui';
import { A2uiExecutionRuntime } from '@lobechat/builtin-tool-a2ui/executionRuntime';
import { createA2uiProcessor } from '@lobehub/a2ui/processor';
import { A2UI_CLI_SYSTEM_PROMPT } from '@lobehub/a2ui/systemPrompt';
import { eq, sql } from 'drizzle-orm';

import { MessageModel } from '@/database/models/message';
import { ChannelError } from '@/database/repositories/channel';
import { channelJobs } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { assertChannelEnabled } from './featureGate';

/** The builtin `renderUI` itself: the same validation and messages; stateless. */
const runtime = new A2uiExecutionRuntime();
/** Docs worded for `lh card guide --components`; built on first use. */
let cliProcessor: ReturnType<typeof createA2uiProcessor> | undefined;

/**
 * One tool call per surface and run: rendering the surface again finds and replaces it. Not a
 * provider id, so it never collides with a call the runtime records.
 */
export const cliCardToolCallId = (operationId: string, surfaceId: string) =>
  `lh_card_${operationId}_${surfaceId}`;

export type ChannelCardRenderResult =
  | { errors: string[]; message: string; ok: false }
  | { message: string; ok: true; replaced: boolean; surfaceId: string };

/**
 * Cards an external CLI runtime draws with `lh card render`. A card is stored exactly as a builtin
 * `lobe-a2ui.renderUI` result: a tool message with the validated surface as its state, under the
 * run's latest step in its Topic. The reply's publish (and every other path that reads a run's
 * cards) finds it with no special case.
 */
export class ChannelCardService {
  private readonly messages: MessageModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly operationId: string,
    private readonly workspaceId?: string,
  ) {
    this.messages = new MessageModel(db, userId, workspaceId);
  }

  /**
   * The `@lobehub/a2ui` card guide worded for `lh card render`, from the same package that
   * validates the builtin tool. Progressive like the builtin: without names, the index of every
   * component; with names, their full schemas and smallest examples.
   */
  guide = async (components?: string[]) => {
    await assertChannelEnabled(this.userId);
    if (!components?.length) return { guide: A2UI_CLI_SYSTEM_PROMPT };
    cliProcessor ??= createA2uiProcessor({ delivery: 'cli' });
    return { guide: cliProcessor.docs({ components }) };
  };

  render = async (operations: unknown): Promise<ChannelCardRenderResult> => {
    await assertChannelEnabled(this.userId);
    const output = await runtime.renderUI({ operations });
    if (!output.success) {
      const errors = (output.error?.body as { errors?: string[] } | undefined)?.errors ?? [];
      return { errors, message: output.content, ok: false };
    }
    const state = output.state as { surface: { surfaceId: string } };
    const { surfaceId } = state.surface;

    // The Topic the reply's publish reads cards from: the run's Channel job's.
    const [job] = await this.db
      .select({ topicId: channelJobs.topicId })
      .from(channelJobs)
      .where(eq(channelJobs.operationId, this.operationId))
      .limit(1);
    if (!job?.topicId)
      throw new ChannelError('CONFLICT', 'This run has no Channel reply to draw a card in');
    const step = await this.messages.findLatestAssistantByOperationId({
      operationId: this.operationId,
      topicId: job.topicId,
    });
    if (!step) throw new ChannelError('CONFLICT', 'This run has not started a step yet');

    const toolCallId = cliCardToolCallId(this.operationId, surfaceId);
    const args = JSON.stringify({ operations });
    // Serialized per run and surface: two overlapping renders of one surface must not both miss
    // the lookup and store the card twice (`tool_call_id` has no unique index).
    const replaced = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${toolCallId}))`);
      const messages = new MessageModel(tx, this.userId, this.workspaceId);
      const existing = await messages.findToolMessageIdByToolCallId(toolCallId);
      if (existing) {
        await messages.updateMessagePlugin(existing, { arguments: args });
        await messages.updateToolMessage(existing, {
          content: output.content,
          pluginState: state,
          replacePluginState: true,
        });
        return true;
      }
      await messages.create({
        agentId: step.agentId ?? undefined,
        content: output.content,
        parentId: step.id,
        plugin: {
          apiName: A2uiApiName.renderUI,
          arguments: args,
          identifier: A2uiIdentifier,
          type: 'builtin',
        },
        pluginState: state,
        role: 'tool',
        threadId: step.threadId ?? undefined,
        tool_call_id: toolCallId,
        topicId: job.topicId!,
      });
      return false;
    });
    return {
      message: output.content,
      ok: true,
      replaced,
      surfaceId,
    };
  };
}
