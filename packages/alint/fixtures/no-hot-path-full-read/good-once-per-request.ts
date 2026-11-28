// Fixture: a user-triggered export reads every row once and writes all of it
// into the archive; it runs once per request, not per step or tick.
import type { ExportContext } from './types';

export async function exportTopic(ctx: ExportContext, topicId: string) {
  const messages = await ctx.messageModel.query({ pageSize: Number.MAX_SAFE_INTEGER, topicId });
  const plugins = await ctx.messageModel.listMessagePluginsByTopic(topicId);

  return ctx.archive.write({ messages, plugins, topicId });
}
