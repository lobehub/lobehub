import { Hono } from 'hono';
import { z } from 'zod';

import { getAllScopePermissions } from '@/utils/rbac';

import {
  CREATE_TOPIC_EXAMPLE,
  example,
  TOPIC_EXAMPLE,
  TOPIC_LIST_EXAMPLE,
} from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { TopicBranchController, TopicController } from '../controllers';
import { EvalContextController } from '../controllers/eval-context.controller';
import { requireAuth } from '../middleware';
import { requireAnyPermission } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import { EvalPaginationSchema } from '../types/eval-resource.type';
import {
  ExportedTopicSchema,
  TopicBatchRequestSchema,
  TopicBatchResultSchema,
  TopicBranchRequestSchema,
  TopicBranchResultSchema,
  TopicCloneRequestSchema,
  TopicCreateRequestSchema,
  TopicDeleteParamSchema,
  TopicForkRequestSchema,
  TopicGetParamSchema,
  TopicIdParamSchema,
  TopicImportRequestSchema,
  TopicImportResultSchema,
  TopicListQuerySchema,
  TopicListSchema,
  TopicMarkReadSchema,
  TopicSchema,
  TopicSearchQuerySchema,
  TopicSearchResultSchema,
  TopicShareRequestSchema,
  TopicShareSchema,
  TopicThreadCreateRequestSchema,
  TopicThreadCreateResultSchema,
  TopicThreadListSchema,
  TopicThreadParamSchema,
  TopicThreadSchema,
  TopicThreadUpdateRequestSchema,
  TopicTranscriptQuerySchema,
  TopicTranscriptSchema,
  TopicUpdateParamSchema,
  TopicUpdateRequestSchema,
} from '../types/topic.type';

// Topic-related routes
const TopicsRoutes = new Hono();

// GET /api/v1/topics - Get topic list (supports pagination and agent/group filtering)
TopicsRoutes.get(
  '/',
  routeDoc({
    data: TopicListSchema,
    responseExample: TOPIC_LIST_EXAMPLE,
    summary: 'List topics',
    tags: ['topics'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('TOPIC_READ'),
    'You do not have permission to read topics',
  ),
  zValidator('query', TopicListQuerySchema),
  (c) => {
    const controller = new TopicController();
    return controller.handleGetTopics(c);
  },
);

// POST /api/v1/topics - Create a new topic
TopicsRoutes.post(
  '/',
  routeDoc({
    data: TopicSchema,
    requestExample: example(TopicCreateRequestSchema, CREATE_TOPIC_EXAMPLE),
    responseExample: TOPIC_EXAMPLE,
    summary: 'Create a topic',
    tags: ['topics'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('TOPIC_CREATE'),
    'You do not have permission to create topics',
  ),
  zValidator('json', TopicCreateRequestSchema),
  (c) => {
    const controller = new TopicController();
    return controller.handleCreateTopic(c);
  },
);

const read = () =>
  requireAnyPermission(
    getAllScopePermissions('TOPIC_READ'),
    'You do not have permission to read topics',
  );
const create = () =>
  requireAnyPermission(
    getAllScopePermissions('TOPIC_CREATE'),
    'You do not have permission to create topics',
  );
const update = () =>
  requireAnyPermission(
    getAllScopePermissions('TOPIC_UPDATE'),
    'You do not have permission to update topics',
  );
const remove = () =>
  requireAnyPermission(
    getAllScopePermissions('TOPIC_DELETE'),
    'You do not have permission to delete topics',
  );
const branch = () => new TopicBranchController();

// GET /api/v1/topics/search - Full-text search over topic titles and messages
TopicsRoutes.get(
  '/search',
  routeDoc({
    operationId: 'topics.search',
    data: TopicSearchResultSchema,
    description:
      "Matches the keywords against topic titles and the messages inside, across the caller's topics or those of one agent / group chat. Most recently active first.",
    summary: 'Search topics',
    tags: ['topics'],
  }),
  requireAuth,
  read(),
  zValidator('query', TopicSearchQuerySchema),
  (c) => branch().handleSearch(c),
);

// POST /api/v1/topics/import - Create a topic from an export or a message list
TopicsRoutes.post(
  '/import',
  routeDoc({
    operationId: 'topics.import',
    data: TopicImportResultSchema,
    description:
      'Accepts what `GET /topics/{id}/export` answers (lossless: tool calls, reasoning and the reply tree survive) or a plain list of `{ role, content }` messages, chained in order. Message ids are re-issued.',
    errors: [404],
    status: 201,
    summary: 'Import a topic',
    tags: ['topics'],
  }),
  requireAuth,
  create(),
  zValidator('json', TopicImportRequestSchema),
  (c) => branch().handleImport(c),
);

// POST /api/v1/topics/batch - Delete or move several topics at once
TopicsRoutes.post(
  '/batch',
  routeDoc({
    operationId: 'topics.batch',
    data: TopicBatchResultSchema,
    description:
      "`delete` moves the topics to the trash; `move` re-homes them, with their messages and threads, on another agent. Ids outside the caller's scope are skipped. In a workspace, only the creator (or a member with workspace-wide rights) may act on a topic.",
    summary: 'Delete or move topics in batch',
    tags: ['topics'],
  }),
  requireAuth,
  requireAnyPermission(
    [...getAllScopePermissions('TOPIC_DELETE'), ...getAllScopePermissions('TOPIC_UPDATE')],
    'You do not have permission to change topics',
  ),
  zValidator('json', TopicBatchRequestSchema),
  (c) => branch().handleBatch(c),
);

// GET /api/v1/topics/:id - Get topic by ID
TopicsRoutes.get(
  '/:id',
  routeDoc({ data: TopicSchema, errors: [404], summary: 'Get a topic', tags: ['topics'] }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('TOPIC_READ'),
    'You do not have permission to read topics',
  ),
  zValidator('param', TopicGetParamSchema),
  (c) => {
    const controller = new TopicController();
    return controller.handleGetTopicById(c);
  },
);

// PATCH /api/v1/topics/:id - Update topic
TopicsRoutes.patch(
  '/:id',
  routeDoc({ data: TopicSchema, errors: [404], summary: 'Update a topic', tags: ['topics'] }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('TOPIC_UPDATE'),
    'You do not have permission to update topics',
  ),
  zValidator('param', TopicUpdateParamSchema),
  zValidator('json', TopicUpdateRequestSchema),
  (c) => {
    const controller = new TopicController();
    return controller.handleUpdateTopic(c);
  },
);

// DELETE /api/v1/topics/:id - Delete topic
TopicsRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    errors: [404],
    summary: 'Delete a topic',
    tags: ['topics'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('TOPIC_DELETE'),
    'You do not have permission to delete topics',
  ),
  zValidator('param', TopicDeleteParamSchema),
  (c) => {
    const controller = new TopicController();
    return controller.handleDeleteTopic(c);
  },
);

// POST /api/v1/topics/:id/clone - Copy a whole topic
TopicsRoutes.post(
  '/:id/clone',
  routeDoc({
    operationId: 'topics.clone',
    data: TopicSchema,
    description: 'Copies the topic with all its messages into a new topic.',
    errors: [404],
    status: 201,
    summary: 'Clone a topic',
    tags: ['topics'],
  }),
  requireAuth,
  create(),
  zValidator('param', TopicIdParamSchema),
  zValidator('json', TopicCloneRequestSchema),
  (c) => branch().handleClone(c),
);

// POST /api/v1/topics/:id/fork - Copy a topic up to one message
TopicsRoutes.post(
  '/:id/fork',
  routeDoc({
    operationId: 'topics.fork',
    data: TopicSchema,
    description:
      'Copies the conversation from its first message through `messageId` into a new topic; later turns and sibling branches stay behind.',
    errors: [404],
    status: 201,
    summary: 'Fork a topic at a message',
    tags: ['topics'],
  }),
  requireAuth,
  create(),
  zValidator('param', TopicIdParamSchema),
  zValidator('json', TopicForkRequestSchema),
  (c) => branch().handleFork(c),
);

// POST /api/v1/topics/:id/branch - Edit a user message into a new topic
TopicsRoutes.post(
  '/:id/branch',
  routeDoc({
    operationId: 'topics.branch',
    data: TopicBranchResultSchema,
    description:
      "Edit-and-resend without rewriting history: copies the user message's ancestor chain (with the tool results along it) into a new topic, ending at that message with the new `content`. The source topic is left as it was.",
    errors: [404],
    status: 201,
    summary: 'Branch a topic at a user message',
    tags: ['topics'],
  }),
  requireAuth,
  create(),
  zValidator('param', TopicIdParamSchema),
  zValidator('json', TopicBranchRequestSchema),
  (c) => branch().handleBranch(c),
);

// GET /api/v1/topics/:id/transcript - Paged transcript, as rows or Markdown
TopicsRoutes.get(
  '/:id/transcript',
  routeDoc({
    data: TopicTranscriptSchema,
    description:
      'Every stored message of the topic in order, threads included, a page at a time. `format=markdown` renders the page as one Markdown document instead of rows.',
    errors: [404],
    summary: 'Get a topic transcript',
    tags: ['topics'],
  }),
  requireAuth,
  read(),
  zValidator('param', TopicIdParamSchema),
  zValidator('query', TopicTranscriptQuerySchema),
  (c) => branch().handleTranscript(c),
);

// GET /api/v1/topics/:id/export - The whole topic in the importable format
TopicsRoutes.get(
  '/:id/export',
  routeDoc({
    operationId: 'topics.export',
    data: ExportedTopicSchema,
    description:
      'The whole topic in the lossless `version: "2.0"` format — what the chat UI exports as JSON and `POST /topics/import` reads back.',
    errors: [404],
    summary: 'Export a topic',
    tags: ['topics'],
  }),
  requireAuth,
  read(),
  zValidator('param', TopicIdParamSchema),
  (c) => branch().handleExport(c),
);

// POST /api/v1/topics/:id/share - Publish or revoke the public link
TopicsRoutes.post(
  '/:id/share',
  routeDoc({
    operationId: 'topics.share',
    data: TopicShareSchema,
    description:
      '`link` publishes the topic to anyone with its URL; `private` revokes the link. In a workspace, an agent whose share policy is restricted only lets its creator and workspace owners publish.',
    errors: [404],
    summary: 'Share or unshare a topic',
    tags: ['topics'],
  }),
  requireAuth,
  update(),
  zValidator('param', TopicIdParamSchema),
  zValidator('json', TopicShareRequestSchema),
  (c) => branch().handleShare(c),
);

// POST /api/v1/topics/:id/read - Clear the unread mark
TopicsRoutes.post(
  '/:id/read',
  routeDoc({
    operationId: 'topics.markRead',
    data: TopicMarkReadSchema,
    description: 'Clears the unread mark a finished run leaves on the topic; a no-op otherwise.',
    errors: [404],
    summary: 'Mark a topic as read',
    tags: ['topics'],
  }),
  requireAuth,
  update(),
  zValidator('param', TopicIdParamSchema),
  (c) => branch().handleMarkRead(c),
);

TopicsRoutes.get(
  '/:topicId/threads',
  routeDoc({
    data: TopicThreadListSchema,
    errors: [404],
    summary: 'List topic threads',
    tags: ['topics'],
  }),
  requireAuth,
  requireAnyPermission(getAllScopePermissions('MESSAGE_READ')),
  zValidator('param', z.object({ topicId: z.string().min(1) })),
  zValidator('query', EvalPaginationSchema),
  async (c) => new EvalContextController().listThreads(c),
);

// POST /api/v1/topics/:topicId/threads - Create a thread, optionally with its first message
TopicsRoutes.post(
  '/:topicId/threads',
  routeDoc({
    operationId: 'topics.createThread',
    data: TopicThreadCreateResultSchema,
    description:
      'Opens a thread in the topic, branching from `sourceMessageId` when given. With `message`, the thread starts with it and takes its first 80 characters as the title.',
    errors: [404],
    status: 201,
    summary: 'Create a topic thread',
    tags: ['topics'],
  }),
  requireAuth,
  create(),
  zValidator('param', z.object({ topicId: z.string().min(1) })),
  zValidator('json', TopicThreadCreateRequestSchema),
  (c) => branch().handleCreateThread(c),
);

// PATCH /api/v1/topics/:topicId/threads/:threadId - Rename a thread or change its status
TopicsRoutes.patch(
  '/:topicId/threads/:threadId',
  routeDoc({
    operationId: 'topics.updateThread',
    data: TopicThreadSchema,
    description:
      "In a workspace, only the thread's creator (or a member with workspace-wide rights) may change it.",
    errors: [404],
    summary: 'Update a topic thread',
    tags: ['topics'],
  }),
  requireAuth,
  update(),
  zValidator('param', TopicThreadParamSchema),
  zValidator('json', TopicThreadUpdateRequestSchema),
  (c) => branch().handleUpdateThread(c),
);

// DELETE /api/v1/topics/:topicId/threads/:threadId - Delete a thread
TopicsRoutes.delete(
  '/:topicId/threads/:threadId',
  routeDoc({
    operationId: 'topics.deleteThread',
    data: DeletedResourceSchema,
    description:
      "In a workspace, only the thread's creator (or a member with workspace-wide rights) may delete it.",
    errors: [404],
    summary: 'Delete a topic thread',
    tags: ['topics'],
  }),
  requireAuth,
  remove(),
  zValidator('param', TopicThreadParamSchema),
  (c) => branch().handleDeleteThread(c),
);

export default TopicsRoutes;
