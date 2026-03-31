import AgentGroupsRoutes from './agent-groups.route';
import AgentsRoutes from './agents.route';
import FileRoutes from './files.route';
import KnowledgeBasesRoutes from './knowledge-bases.route';
import MessageTranslationsRoutes from './message-translations.route';
import MessagesRoutes from './messages.route';
import ModelsRoutes from './models.route';
import PermissionsRoutes from './permissions.route';
import ProvidersRoutes from './providers.route';
import ResponsesRoutes from './responses.route';
import RolesRoutes from './roles.route';
import TopicsRoutes from './topics.route';
import UsersRoutes from './users.route';

export default {
  'agent-groups': AgentGroupsRoutes,
  'agents': AgentsRoutes,
  'files': FileRoutes,
  'knowledge-bases': KnowledgeBasesRoutes,
  'message-translations': MessageTranslationsRoutes,
  'messages': MessagesRoutes,
  'models': ModelsRoutes,
  'permissions': PermissionsRoutes,
  'providers': ProvidersRoutes,
  'responses': ResponsesRoutes,
  'roles': RolesRoutes,
  'topics': TopicsRoutes,
  'users': UsersRoutes,
};
