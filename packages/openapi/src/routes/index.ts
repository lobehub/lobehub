import AgentGroupsRoutes from './agent-groups.route';
import AgentsRoutes from './agents.route';
import AnthropicRoutes from './anthropic.route';
import ApiKeysRoutes from './api-keys.route';
import AudioRoutes from './audio.route';
import ChatRoutes from './chat.route';
import ChatGroupsRoutes from './chat-groups.route';
import CollaboratorRoutes from './collaborators.route';
import EvalRoutes from './eval.route';
import FileRoutes from './files.route';
import GoalsRoutes from './goals.route';
import ImRoutes from './im.route';
import KnowledgeBasesRoutes from './knowledge-bases.route';
import McpServersRoutes from './mcp-servers.route';
import MemoriesRoutes from './memories.route';
import MessageTranslationsRoutes from './message-translations.route';
import MessagesRoutes from './messages.route';
import ModelsRoutes from './models.route';
import NotificationsRoutes from './notifications.route';
import OpenAIRoutes from './openai.route';
import PermissionsRoutes from './permissions.route';
import { PluginsRoutes } from './plugins.route';
import ProvidersRoutes from './providers.route';
import PushTokenRoutes from './push-tokens.route';
import ResponsesRoutes from './responses.route';
import RolesRoutes from './roles.route';
import ShareLinkRoutes from './share-links.route';
import AgentSignalsRoutes from './signals.route';
import TasksRoutes from './tasks.route';
import TopicsRoutes from './topics.route';
import TransferRequestRoutes from './transfer-requests.route';
import UsageRoutes from './usage.route';
import UsersRoutes from './users.route';
import WorkspaceRoutes from './workspaces.route';

export default {
  'agent-groups': AgentGroupsRoutes,
  'agents': AgentsRoutes,
  'anthropic': AnthropicRoutes,
  'api-keys': ApiKeysRoutes,
  'audio': AudioRoutes,
  'chat': ChatRoutes,
  'chat-groups': ChatGroupsRoutes,
  'eval': EvalRoutes,
  'plugins': PluginsRoutes,
  'files': FileRoutes,
  'goals': GoalsRoutes,
  'im': ImRoutes,
  'knowledge-bases': KnowledgeBasesRoutes,
  'mcp-servers': McpServersRoutes,
  'memories': MemoriesRoutes,
  'message-translations': MessageTranslationsRoutes,
  'messages': MessagesRoutes,
  'models': ModelsRoutes,
  'notifications': NotificationsRoutes,
  'openai': OpenAIRoutes,
  'permissions': PermissionsRoutes,
  'providers': ProvidersRoutes,
  'push-tokens': PushTokenRoutes,
  'responses': ResponsesRoutes,
  'roles': RolesRoutes,
  'signals': AgentSignalsRoutes,
  'tasks': TasksRoutes,
  'topics': TopicsRoutes,
  'users': UsersRoutes,
  'usage': UsageRoutes,
  'workspaces': WorkspaceRoutes,
  'transfer-requests': TransferRequestRoutes,
  'share-links': ShareLinkRoutes,
  // Last: its leading path parameter only matches `/{type}/{id}/collaborators…`.
  ':resourceType/:resourceId/collaborators': CollaboratorRoutes,
};
