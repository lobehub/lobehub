import AgentGroupRoutes from './agent-groups.route';
import AgentRoutes from './agents.route';
import FileRoutes from './files.route';
import KnowledgeBaseRoutes from './knowledgeBases.route';
import MessageRoutes from './message.route';
import MessageTranslationsRoutes from './message-translations.route';
import ModelRoutes from './models.route';
import PermissionsRoutes from './permissions.route';
import ProviderRoutes from './providers.route';
import RolesRoutes from './roles.route';
import TopicsRoutes from './topics.route';
import UserRoutes from './users.route';

export default {
  'agent-groups': AgentGroupRoutes,
  'agents': AgentRoutes,
  'files': FileRoutes,
  'knowledge-bases': KnowledgeBaseRoutes,
  'message-translations': MessageTranslationsRoutes,
  'messages': MessageRoutes,
  'models': ModelRoutes,
  'permissions': PermissionsRoutes,
  'providers': ProviderRoutes,
  'roles': RolesRoutes,
  'topics': TopicsRoutes,
  'users': UserRoutes,
};
