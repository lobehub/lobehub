import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { MessageController } from '../controllers';
import { requireAuth } from '../middleware';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  MessageIdParamSchema,
  MessagesCountQuerySchema,
  MessagesCreateRequestSchema,
  MessagesCreateWithReplyRequestSchema,
  MessagesDeleteBatchRequestSchema,
  MessagesListQuerySchema,
} from '../types/message.type';

// Messages 相关路由
const MessageRoutes = new Hono();

// GET /api/v1/messages/count - 统计消息数量 (支持各种过滤条件)
MessageRoutes.get(
  '/count',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_READ'),
    'You do not have permission to read message statistics',
  ),
  zValidator('query', MessagesCountQuerySchema),
  (c) => {
    const controller = new MessageController();
    return controller.handleCountMessages(c);
  },
);

// GET /api/v1/messages - 获取消息列表 (支持各种过滤和搜索)
MessageRoutes.get(
  '/',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_READ'),
    'You do not have permission to read messages',
  ),
  zValidator('query', MessagesListQuerySchema),
  (c) => {
    const controller = new MessageController();
    return controller.handleGetMessages(c);
  },
);

// GET /api/v1/messages/:id - 根据消息ID获取消息详情 (需要消息读取权限)
MessageRoutes.get(
  '/:id',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_READ'),
    'You do not have permission to read message details',
  ),
  zValidator('param', MessageIdParamSchema),
  (c) => {
    const controller = new MessageController();
    return controller.handleGetMessageById(c);
  },
);

// POST /api/v1/messages - 创建新消息 (需要消息写入权限)
MessageRoutes.post(
  '/',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_CREATE'),
    'You do not have permission to create messages',
  ),
  zValidator('json', MessagesCreateRequestSchema),
  (c) => {
    const controller = new MessageController();

    return controller.handleCreateMessage(c);
  },
);

// POST /api/v1/messages/replies - 创建用户消息并生成 AI 回复 (需要消息写入权限)
MessageRoutes.post(
  '/replies',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_CREATE'),
    'You do not have permission to create messages',
  ),
  zValidator('json', MessagesCreateWithReplyRequestSchema),
  (c) => {
    const controller = new MessageController();
    return controller.handleCreateMessageWithAIReply(c);
  },
);

// DELETE /api/v1/messages/:id - 删除单个消息 (需要消息删除权限)
MessageRoutes.delete(
  '/:id',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_DELETE'),
    'You do not have permission to delete messages',
  ),
  zValidator('param', MessageIdParamSchema),
  (c) => {
    const controller = new MessageController();
    return controller.handleDeleteMessage(c);
  },
);

// DELETE /api/v1/messages - 批量删除消息 (需要消息删除权限)
MessageRoutes.delete(
  '/',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_DELETE'),
    'You do not have permission to delete messages',
  ),
  zValidator('json', MessagesDeleteBatchRequestSchema),
  (c) => {
    const controller = new MessageController();
    return controller.handleDeleteBatchMessages(c);
  },
);

export default MessageRoutes;
