import type {
  ArtboardCommentThreadView,
  ArtboardCommentView,
  ArtboardContent,
} from '@lobechat/types';
import type { Command } from 'commander';

import { getTrpcClient } from '../api/client';
import { outputJson } from '../utils/format';

const runAgentId = () => {
  const id = process.env.LOBEHUB_AGENT_ID?.trim();
  if (!id)
    throw new Error(
      'Comments are answered by the agent of a LobeHub conversation, and LOBEHUB_AGENT_ID is not set in this shell',
    );
  return id;
};

const placeOf = (thread: ArtboardCommentThreadView, content: ArtboardContent) => {
  const board = content.boards.find((item) => item.id === thread.boardId);
  if (board) return `board ${board.id} "${board.title}"`;
  const group = content.groups.find((item) => item.id === thread.groupId);
  if (group) return `group ${group.id} "${group.title}"`;
  const page = content.pages.find((item) => item.id === thread.pageId);
  return page ? `page ${page.id} "${page.name}"` : 'the canvas';
};

const speaker = (comment: ArtboardCommentView) => (comment.authorAgentId ? 'you' : 'user');

const formatThread = (thread: ArtboardCommentThreadView, content: ArtboardContent) => {
  const tags = [
    thread.unread && 'new',
    thread.resolvedAt && 'resolved',
    thread.stale && 'screen changed since',
  ].filter(Boolean);
  return [
    `${thread.id}  on ${placeOf(thread, content)}${tags.length ? `  [${tags.join(', ')}]` : ''}`,
    ...[thread, ...thread.replies].map((comment) => `  ${speaker(comment)}: ${comment.content}`),
  ].join('\n');
};

const textOf = (words: string[]) => {
  const text = words.join(' ').trim();
  if (!text) throw new Error('Write the text after the id');
  return text;
};

export const registerArtboardCommentCommands = (artboard: Command) => {
  artboard
    .command('comments <id>')
    .description(
      "Print the user's comment threads waiting for you, with their ids; the ones printed count as read",
    )
    .option('--json', 'Print structured JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const agentId = runAgentId();
      const client = await getTrpcClient();
      const [threads, { artboard: board }] = await Promise.all([
        client.artboard.takeComments.mutate({ agentId, id }),
        client.artboard.read.query({ id }),
      ]);
      if (options.json) return outputJson(threads);
      if (!threads.length) return console.log('No comment threads are waiting for you');
      console.log(threads.map((thread) => formatThread(thread, board.content)).join('\n\n'));
    });

  artboard
    .command('reply <commentId> <text...>')
    .description('Answer a comment thread on the artboard')
    .action(async (commentId: string, words: string[]) => {
      const agentId = runAgentId();
      const client = await getTrpcClient();
      await client.artboard.replyAsAgent.mutate({ agentId, commentId, content: textOf(words) });
      console.log(`replied in ${commentId}`);
    });

  artboard
    .command('resolve <commentId>')
    .description(
      'Close a thread once what it asks for is done, or once your question in it is answered',
    )
    .action(async (commentId: string) => {
      const client = await getTrpcClient();
      await client.artboard.resolveComment.mutate({ commentId });
      console.log(`resolved ${commentId}`);
    });

  artboard
    .command('ask <id> <text...>')
    .description(
      'Ask the user a question on the artboard as a new thread; the artboard cannot be finalized while it is open',
    )
    .option('--board <boardId>', 'Board the question is about')
    .option('--group <groupId>', 'Group the question is about')
    .option('--page <pageId>', 'Page the question is about')
    .action(
      async (
        id: string,
        words: string[],
        options: { board?: string; group?: string; page?: string },
      ) => {
        const agentId = runAgentId();
        const client = await getTrpcClient();
        const question = await client.artboard.askQuestion.mutate({
          agentId,
          boardId: options.board,
          content: textOf(words),
          groupId: options.group,
          id,
          pageId: options.page,
        });
        console.log(`asked ${question.id}`);
      },
    );
};
