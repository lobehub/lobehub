import {
  LobeActivatorInspectors,
  LobeActivatorManifest,
  LobeActivatorRenders,
} from '@lobechat/builtin-tool-activator/client';
import {
  AgentBuilderInspectors,
  AgentBuilderInterventions,
  AgentBuilderManifest,
  AgentBuilderRenders,
  AgentBuilderStreamings,
} from '@lobechat/builtin-tool-agent-builder/client';
import {
  AgentDocumentsInspectors,
  AgentDocumentsManifest,
  AgentDocumentsRenders,
  AgentDocumentsStreamings,
} from '@lobechat/builtin-tool-agent-documents/client';
import {
  AgentManagementInspectors,
  AgentManagementManifest,
  AgentManagementRenders,
  AgentManagementStreamings,
} from '@lobechat/builtin-tool-agent-management/client';
import {
  ClaudeCodeIdentifier,
  ClaudeCodeInspectors,
  ClaudeCodeInterventions,
  ClaudeCodeRenders,
  ClaudeCodeStreamings,
} from '@lobechat/builtin-tool-claude-code/client';
import {
  CloudSandboxInspectors,
  CloudSandboxInterventions,
  CloudSandboxManifest,
  CloudSandboxRenders,
  CloudSandboxStreamings,
} from '@lobechat/builtin-tool-cloud-sandbox/client';
import {
  GroupAgentBuilderInspectors,
  GroupAgentBuilderManifest,
  GroupAgentBuilderRenders,
  GroupAgentBuilderStreamings,
} from '@lobechat/builtin-tool-group-agent-builder/client';
import {
  GroupManagementInspectors,
  GroupManagementInterventions,
  GroupManagementManifest,
  GroupManagementRenders,
  GroupManagementStreamings,
} from '@lobechat/builtin-tool-group-management/client';
import {
  KnowledgeBaseInspectors,
  KnowledgeBaseManifest,
  KnowledgeBaseRenders,
} from '@lobechat/builtin-tool-knowledge-base/client';
import {
  LobeAgentInspectors,
  LobeAgentInterventions,
  LobeAgentManifest,
  LobeAgentRenders,
  LobeAgentStreamings,
} from '@lobechat/builtin-tool-lobe-agent/client';
import {
  LobeDeliveryCheckerInspectors,
  LobeDeliveryCheckerManifest,
  LobeDeliveryCheckerPortal,
  LobeDeliveryCheckerPortalActions,
  LobeDeliveryCheckerPortalTitle,
  LobeDeliveryCheckerRenders,
} from '@lobechat/builtin-tool-lobe-delivery-checker/client';
import {
  LocalSystemApiName,
  LocalSystemIdentifier,
  LocalSystemInspectors,
  LocalSystemInterventions,
  LocalSystemListFilesPlaceholder,
  LocalSystemManifest,
  LocalSystemRenders,
  LocalSystemSearchFilesPlaceholder,
  LocalSystemStreamings,
} from '@lobechat/builtin-tool-local-system/client';
import {
  MemoryInspectors,
  MemoryInterventions,
  MemoryManifest,
  MemoryRenders,
  MemoryStreamings,
} from '@lobechat/builtin-tool-memory/client';
import {
  MessageInspectors,
  MessageInterventions,
  MessageManifest,
  MessageRenders,
  MessageStreamings,
} from '@lobechat/builtin-tool-message/client';
import {
  PageAgentInspectors,
  PageAgentManifest,
  PageAgentRenders,
  PageAgentStreamings,
} from '@lobechat/builtin-tool-page-agent/client';
import {
  RemoteDeviceManifest,
  RemoteDeviceRenders,
} from '@lobechat/builtin-tool-remote-device/client';
import {
  SelfFeedbackIntentInspectors,
  selfFeedbackIntentManifest,
} from '@lobechat/builtin-tool-self-iteration/client';
import {
  SkillStoreInspectors,
  SkillStoreManifest,
  SkillStoreRenders,
} from '@lobechat/builtin-tool-skill-store/client';
import {
  SkillsInspectors,
  SkillsManifest,
  SkillsRenders,
} from '@lobechat/builtin-tool-skills/client';
import { TaskInspectors, TaskManifest, TaskRenders } from '@lobechat/builtin-tool-task/client';
import {
  UserInteractionIdentifier,
  UserInteractionInterventions,
} from '@lobechat/builtin-tool-user-interaction/client';
import {
  WebBrowsingInspectors,
  WebBrowsingManifest,
  WebBrowsingPlaceholders,
  WebBrowsingPortal,
  WebBrowsingPortalTitle,
  WebBrowsingRenders,
} from '@lobechat/builtin-tool-web-browsing/client';
import {
  WebOnboardingInspectors,
  WebOnboardingInterventions,
  WebOnboardingManifest,
  WebOnboardingRenders,
} from '@lobechat/builtin-tool-web-onboarding/client';
import { RunCommandRender } from '@lobechat/shared-tool-ui/renders';
import type {
  BuiltinInspector,
  BuiltinIntervention,
  BuiltinPlaceholder,
  BuiltinPortal,
  BuiltinPortalTitle,
  BuiltinRender,
  BuiltinStreaming,
} from '@lobechat/types';

import { CodexInspectors, CodexRenders } from './codex';
import { GithubIdentifier, GithubInspectors, GithubRenders } from './github';
import { registerBuiltinInspectors } from './inspectors';
import { registerBuiltinInterventions } from './interventions';
import { LinearIdentifier, LinearInspectors, LinearRenders } from './linear';
import { NotebookIdentifier, NotebookRenders } from './notebook';
import { registerBuiltinPlaceholders } from './placeholders';
import { registerBuiltinPortals } from './portals';
import { registerBuiltinRenders } from './renders';
import { registerBuiltinStreamings } from './streamings';
import { TwitterIdentifier, TwitterInspectors } from './twitter';

let builtinToolSurfacesRegistered = false;

export const registerBuiltinToolSurfaces = (): void => {
  if (builtinToolSurfacesRegistered) return;

  registerBuiltinRenders({
    [AgentBuilderManifest.identifier]: AgentBuilderRenders as Record<string, BuiltinRender>,
    [AgentDocumentsManifest.identifier]: AgentDocumentsRenders as Record<string, BuiltinRender>,
    [AgentManagementManifest.identifier]: AgentManagementRenders as Record<string, BuiltinRender>,
    [ClaudeCodeIdentifier]: ClaudeCodeRenders as Record<string, BuiltinRender>,
    [CloudSandboxManifest.identifier]: CloudSandboxRenders as Record<string, BuiltinRender>,
    [GroupAgentBuilderManifest.identifier]: GroupAgentBuilderRenders as Record<
      string,
      BuiltinRender
    >,
    [GroupManagementManifest.identifier]: GroupManagementRenders as Record<string, BuiltinRender>,
    [KnowledgeBaseManifest.identifier]: KnowledgeBaseRenders as Record<string, BuiltinRender>,
    [LobeAgentManifest.identifier]: LobeAgentRenders as Record<string, BuiltinRender>,
    [LobeDeliveryCheckerManifest.identifier]: LobeDeliveryCheckerRenders as Record<
      string,
      BuiltinRender
    >,
    [LocalSystemManifest.identifier]: LocalSystemRenders as Record<string, BuiltinRender>,
    [MemoryManifest.identifier]: MemoryRenders as Record<string, BuiltinRender>,
    [MessageManifest.identifier]: MessageRenders as Record<string, BuiltinRender>,
    [NotebookIdentifier]: NotebookRenders,
    [PageAgentManifest.identifier]: PageAgentRenders as Record<string, BuiltinRender>,
    [RemoteDeviceManifest.identifier]: RemoteDeviceRenders as Record<string, BuiltinRender>,
    [SkillStoreManifest.identifier]: SkillStoreRenders as Record<string, BuiltinRender>,
    [SkillsManifest.identifier]: SkillsRenders as Record<string, BuiltinRender>,
    [TaskManifest.identifier]: TaskRenders as Record<string, BuiltinRender>,
    [LobeActivatorManifest.identifier]: LobeActivatorRenders as Record<string, BuiltinRender>,
    [WebBrowsingManifest.identifier]: WebBrowsingRenders as Record<string, BuiltinRender>,
    [WebOnboardingManifest.identifier]: WebOnboardingRenders as Record<string, BuiltinRender>,
    codex: {
      ...CodexRenders,
      command_execution: RunCommandRender as BuiltinRender,
    },
    [GithubIdentifier]: GithubRenders,
    [LinearIdentifier]: LinearRenders,
  });

  registerBuiltinInspectors({
    [AgentBuilderManifest.identifier]: AgentBuilderInspectors as Record<string, BuiltinInspector>,
    [AgentDocumentsManifest.identifier]: AgentDocumentsInspectors as Record<
      string,
      BuiltinInspector
    >,
    [AgentManagementManifest.identifier]: AgentManagementInspectors as Record<
      string,
      BuiltinInspector
    >,
    [ClaudeCodeIdentifier]: ClaudeCodeInspectors as Record<string, BuiltinInspector>,
    [CloudSandboxManifest.identifier]: CloudSandboxInspectors as Record<string, BuiltinInspector>,
    [GroupAgentBuilderManifest.identifier]: GroupAgentBuilderInspectors as Record<
      string,
      BuiltinInspector
    >,
    [GroupManagementManifest.identifier]: GroupManagementInspectors as Record<
      string,
      BuiltinInspector
    >,
    [KnowledgeBaseManifest.identifier]: KnowledgeBaseInspectors as Record<string, BuiltinInspector>,
    [LobeAgentManifest.identifier]: LobeAgentInspectors as Record<string, BuiltinInspector>,
    [LobeDeliveryCheckerManifest.identifier]: LobeDeliveryCheckerInspectors as Record<
      string,
      BuiltinInspector
    >,
    [LocalSystemManifest.identifier]: LocalSystemInspectors as Record<string, BuiltinInspector>,
    [MemoryManifest.identifier]: MemoryInspectors as Record<string, BuiltinInspector>,
    [MessageManifest.identifier]: MessageInspectors as Record<string, BuiltinInspector>,
    [PageAgentManifest.identifier]: PageAgentInspectors as Record<string, BuiltinInspector>,
    [LobeActivatorManifest.identifier]: LobeActivatorInspectors as Record<string, BuiltinInspector>,
    [selfFeedbackIntentManifest.identifier]: SelfFeedbackIntentInspectors as Record<
      string,
      BuiltinInspector
    >,
    [SkillStoreManifest.identifier]: SkillStoreInspectors as Record<string, BuiltinInspector>,
    [SkillsManifest.identifier]: SkillsInspectors as Record<string, BuiltinInspector>,
    [TaskManifest.identifier]: TaskInspectors as Record<string, BuiltinInspector>,
    [WebBrowsingManifest.identifier]: WebBrowsingInspectors as Record<string, BuiltinInspector>,
    [WebOnboardingManifest.identifier]: WebOnboardingInspectors as Record<string, BuiltinInspector>,
    codex: CodexInspectors,
    [GithubIdentifier]: GithubInspectors,
    [LinearIdentifier]: LinearInspectors,
    [TwitterIdentifier]: TwitterInspectors,
  });

  registerBuiltinStreamings({
    [AgentBuilderManifest.identifier]: AgentBuilderStreamings as Record<string, BuiltinStreaming>,
    [AgentDocumentsManifest.identifier]: AgentDocumentsStreamings as Record<
      string,
      BuiltinStreaming
    >,
    [AgentManagementManifest.identifier]: AgentManagementStreamings as Record<
      string,
      BuiltinStreaming
    >,
    [ClaudeCodeIdentifier]: ClaudeCodeStreamings as Record<string, BuiltinStreaming>,
    [CloudSandboxManifest.identifier]: CloudSandboxStreamings as Record<string, BuiltinStreaming>,
    [GroupAgentBuilderManifest.identifier]: GroupAgentBuilderStreamings as Record<
      string,
      BuiltinStreaming
    >,
    [GroupManagementManifest.identifier]: GroupManagementStreamings as Record<
      string,
      BuiltinStreaming
    >,
    [LobeAgentManifest.identifier]: LobeAgentStreamings as Record<string, BuiltinStreaming>,
    [LocalSystemManifest.identifier]: LocalSystemStreamings as Record<string, BuiltinStreaming>,
    [MemoryManifest.identifier]: MemoryStreamings as Record<string, BuiltinStreaming>,
    [MessageManifest.identifier]: MessageStreamings as Record<string, BuiltinStreaming>,
    [PageAgentManifest.identifier]: PageAgentStreamings as Record<string, BuiltinStreaming>,
  });

  registerBuiltinInterventions({
    [AgentBuilderManifest.identifier]: AgentBuilderInterventions as Record<
      string,
      BuiltinIntervention
    >,
    [ClaudeCodeIdentifier]: ClaudeCodeInterventions as Record<string, BuiltinIntervention>,
    [CloudSandboxManifest.identifier]: CloudSandboxInterventions as Record<
      string,
      BuiltinIntervention
    >,
    [GroupManagementManifest.identifier]: GroupManagementInterventions as Record<
      string,
      BuiltinIntervention
    >,
    [LobeAgentManifest.identifier]: LobeAgentInterventions as Record<string, BuiltinIntervention>,
    [LocalSystemIdentifier]: LocalSystemInterventions as Record<string, BuiltinIntervention>,
    [MemoryManifest.identifier]: MemoryInterventions as Record<string, BuiltinIntervention>,
    [MessageManifest.identifier]: MessageInterventions as Record<string, BuiltinIntervention>,
    [UserInteractionIdentifier]: UserInteractionInterventions as Record<
      string,
      BuiltinIntervention
    >,
    [WebOnboardingManifest.identifier]: WebOnboardingInterventions as Record<
      string,
      BuiltinIntervention
    >,
  });

  registerBuiltinPlaceholders({
    [LocalSystemIdentifier]: {
      [LocalSystemApiName.searchFiles]: LocalSystemSearchFilesPlaceholder as BuiltinPlaceholder,
      [LocalSystemApiName.listFiles]: LocalSystemListFilesPlaceholder as BuiltinPlaceholder,
      // Legacy aliases — keep these so historical messages keep rendering.
      listLocalFiles: LocalSystemListFilesPlaceholder as BuiltinPlaceholder,
      searchLocalFiles: LocalSystemSearchFilesPlaceholder as BuiltinPlaceholder,
    },
    [WebBrowsingManifest.identifier]: WebBrowsingPlaceholders as Record<string, BuiltinPlaceholder>,
  });

  registerBuiltinPortals({
    actions: {
      [LobeDeliveryCheckerManifest.identifier]:
        LobeDeliveryCheckerPortalActions as BuiltinPortalTitle,
    },
    portals: {
      [LobeDeliveryCheckerManifest.identifier]: LobeDeliveryCheckerPortal as BuiltinPortal,
      [WebBrowsingManifest.identifier]: WebBrowsingPortal as BuiltinPortal,
    },
    titles: {
      [LobeDeliveryCheckerManifest.identifier]:
        LobeDeliveryCheckerPortalTitle as BuiltinPortalTitle,
      [WebBrowsingManifest.identifier]: WebBrowsingPortalTitle as BuiltinPortalTitle,
    },
  });

  builtinToolSurfacesRegistered = true;
};
