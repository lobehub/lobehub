import { agentBuilderExecutor } from '@lobechat/builtin-tool-agent-builder/executor';
import { agentManagementExecutor } from '@lobechat/builtin-tool-agent-management/executor';
import { browserExecutor } from '@lobechat/builtin-tool-browser/client/executor';
import { calculatorExecutor } from '@lobechat/builtin-tool-calculator/executor';
import { cloudSandboxExecutor } from '@lobechat/builtin-tool-cloud-sandbox/executor';
import { credsExecutor } from '@lobechat/builtin-tool-creds/executor';
import { goalExecutor } from '@lobechat/builtin-tool-goal/client/executor';
import { groupAgentBuilderExecutor } from '@lobechat/builtin-tool-group-agent-builder/executor';
import { groupManagementExecutor } from '@lobechat/builtin-tool-group-management/executor';
import { imageGenerationExecutor } from '@lobechat/builtin-tool-image-generation/executor';
import { knowledgeBaseExecutor } from '@lobechat/builtin-tool-knowledge-base/client/executor';
import { lobeAgentExecutor } from '@lobechat/builtin-tool-lobe-agent/client/executor';
import { localSystemExecutor } from '@lobechat/builtin-tool-local-system/client/executor';
import { memoryExecutor } from '@lobechat/builtin-tool-memory/executor';
import { taskExecutor } from '@lobechat/builtin-tool-task/client/executor';

import type { IBuiltinToolExecutor } from '../types';
import {
  ampExecutor,
  claudeCodeExecutor,
  codeBuddyExecutor,
  codexExecutor,
  cursorExecutor,
  openCodeExecutor,
  piExecutor,
  qoderExecutor,
} from './heteroCli';
import { activatorExecutor } from './lobe-activator';
import { agentDocumentsExecutor } from './lobe-agent-documents';
import { messageExecutor } from './lobe-message';
import { notebookExecutor } from './lobe-notebook';
import { pageAgentExecutor } from './lobe-page-agent';
import { skillStoreExecutor } from './lobe-skill-store';
import { skillsExecutor } from './lobe-skills';
import { topicReferenceExecutor } from './lobe-topic-reference';
import { userInteractionExecutor } from './lobe-user-interaction';
import { webBrowsing } from './lobe-web-browsing';
import { webOnboardingExecutor } from './lobe-web-onboarding';

export const builtinToolExecutors = [
  // Hook-only executors for heterogeneous CLI agents —
  // observe their shell tool results via `onAfterCall` (never invoked).
  ampExecutor,
  claudeCodeExecutor,
  codeBuddyExecutor,
  codexExecutor,
  cursorExecutor,
  openCodeExecutor,
  piExecutor,
  qoderExecutor,
  agentBuilderExecutor,
  agentDocumentsExecutor,
  agentManagementExecutor,
  calculatorExecutor,
  cloudSandboxExecutor,
  credsExecutor,
  groupAgentBuilderExecutor,
  groupManagementExecutor,
  goalExecutor,
  imageGenerationExecutor,
  knowledgeBaseExecutor,
  browserExecutor,
  localSystemExecutor,
  memoryExecutor,
  messageExecutor,
  notebookExecutor,
  pageAgentExecutor,
  skillStoreExecutor,
  skillsExecutor,
  taskExecutor,
  activatorExecutor,
  topicReferenceExecutor,
  userInteractionExecutor,
  lobeAgentExecutor,
  webOnboardingExecutor,
  webBrowsing,
] satisfies IBuiltinToolExecutor[];
