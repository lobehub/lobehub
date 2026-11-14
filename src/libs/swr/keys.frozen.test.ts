import { describe, expect, it } from 'vitest';

import * as keyRegistry from './keys';

/**
 * SWR key registry freeze.
 *
 * Server data the UI paints moves onto `local-replica` (`@/libs/replica`, see the
 * `zustand` skill, "Replica-Backed Server Data"). The SWR key factories below are
 * legacy: nothing may be added here, and this list only shrinks.
 *
 * - A key you need is missing → model the data as a replica instead of adding a key.
 * - You removed or migrated a key → delete its entry here too.
 */
const LEGACY_SWR_KEYS = [
  'acceptanceCollaborationKeys.conversation',
  'agentConfigKeys.search',
  'agentHomeKeys.topics',
  'apiKeyKeys.list',
  'authKeys.oidcClientMetadata',
  'authKeys.oidcInteraction',
  'botWakeKeys.decisions',
  'botWakeKeys.summary',
  'canvasKeys.storage',
  'changelogKeys.modalIndex',
  'changelogKeys.post',
  'channelKeys.agentEnvironment',
  'channelKeys.userCandidates',
  'channelKeys.wakeConfig',
  'cronKeys.topicsWithJobInfo',
  'deviceKeys.appUpdateState',
  'deviceKeys.browseDirectory',
  'deviceKeys.cliUpdateState',
  'deviceKeys.gitLinkedPR',
  'deviceKeys.gitPullRequestActivity',
  'deviceKeys.gitPullRequestDetail',
  'deviceKeys.gitPullRequestMergeContext',
  'deviceKeys.gitReviewPatches',
  'deviceKeys.repoType',
  'deviceKeys.systemInfo',
  'documentCommentKeys.anchors',
  'documentCommentKeys.detail',
  'documentCommentKeys.replies',
  'documentCommentKeys.summary',
  'documentCommentKeys.threads',
  'documentLikeKeys.summary',
  'electronKeys.appMenu',
  'electronKeys.appTrayVisible',
  'electronKeys.claudeCodeAccounts',
  'electronKeys.desktopHotkeys',
  'electronKeys.gatewayDeviceInfo',
  'electronKeys.proxySettings',
  'electronKeys.remoteServerConfig',
  'electronKeys.workspaceDeviceId',
  'evalKeys.benchmarkDetail',
  'evalKeys.benchmarks',
  'evalKeys.datasetRuns',
  'evalKeys.runDetail',
  'evalKeys.runResults',
  'evalKeys.runs',
  'evalKeys.testCaseDetail',
  'evalKeys.testCases',
  'fileKeys.ttsFile',
  'gatewayKeys.clientLlmWaits',
  'gatewayKeys.reconnect',
  'globalKeys.latestVersion',
  'globalKeys.serverVersion',
  'globalKeys.systemStatus',
  'goalKeys.pendingClarifications',
  'goalKeys.pendingForIsland',
  'groupKeys.queryAgentsForCreate',
  'imageKeys.generationStatus',
  'imessageKeys.bridgeStatus',
  'inboxKeys.unreadCount',
  'inboxKeys.unreadMentions',
  'localFileKeys.claudeCodeMemory',
  'localFileKeys.gitWorkingTreeFiles',
  'localFileKeys.preview',
  'localFileKeys.projectIndex',
  'mcpAppKeys.resource',
  'messageKeys.list',
  'messengerKeys.myLink',
  'messengerKeys.peek',
  'ollamaKeys.downloadModel',
  'onboardingKeys.agentBootstrap',
  'onboardingKeys.agentHistoryTopics',
  'onboardingKeys.analysisStatus',
  'onboardingKeys.profile',
  'onboardingKeys.suggestedTasks',
  'onboardingKeys.understandingSession',
  'onboardingKeys.understandingStart',
  'onboardingKeys.understandingTopic',
  'openInAppKeys.detect',
  'ragEvalKeys.datasetList',
  'ragEvalKeys.datasetRecords',
  'ragEvalKeys.evaluationList',
  'recommendationsKeys.heteroDetections',
  'resourceKeys.list',
  'scmKeys.changeRequests',
  'scmKeys.repositories',
  'scmKeys.wakeTarget',
  'serverConfigKeys.get',
  'shareKeys.agentInfo',
  'shareKeys.agentShareConnectors',
  'shareKeys.agentShareEligibleWorks',
  'shareKeys.agentShareGrantableSkills',
  'shareKeys.agentShareStats',
  'shareKeys.agentShareStatus',
  'shareKeys.artifact',
  'shareKeys.file',
  'shareKeys.pageDocument',
  'shareKeys.topic',
  'shareKeys.visitorTopics',
  'taskLabelKeys.list',
  'threadKeys.list',
  'toolKeys.agentSkillDetail',
  'toolKeys.agentSkills',
  'toolKeys.composioAppTools',
  'toolKeys.composioConnections',
  'topicActionKeys.openNewOrSave',
  'topicKeys.list',
  'topicKeys.scheduledRunWatch',
  'topicKeys.search',
  'userKeys.checkTrace',
  'userMemoryKeys.activities',
  'userMemoryKeys.analysisTask',
  'userMemoryKeys.contextStories',
  'userMemoryKeys.contextStory',
  'userMemoryKeys.contexts',
  'userMemoryKeys.experiences',
  'userMemoryKeys.memoryDetail',
  'userMemoryKeys.persona',
  'userMemoryKeys.preferences',
  'userMemoryKeys.retrieve',
  'userMemoryKeys.tags',
  'verifyKeys.acceptancePurgePreview',
  'verifyKeys.runAcceptanceRound',
  'videoKeys.generationStatus',
  'workKeys.conversation',
  'workKeys.versions',
  'workKeys.workspace',
];

const collectRegistryKeys = () =>
  Object.entries(keyRegistry)
    .filter(
      ([name, value]) =>
        name.endsWith('Keys') && name !== 'swrKeys' && typeof value === 'object' && value !== null,
    )
    .flatMap(([name, value]) => Object.keys(value).map((prop) => `${name}.${prop}`))
    .sort();

describe('SWR key registry freeze', () => {
  it('adds no new SWR keys — new server data goes through local-replica', () => {
    const added = collectRegistryKeys().filter((key) => !LEGACY_SWR_KEYS.includes(key));

    expect(
      added,
      'New SWR keys are frozen. Model this server data with local-replica (`@/libs/replica`, zustand skill "Replica-Backed Server Data") instead of adding a key to src/libs/swr/keys.ts.',
    ).toEqual([]);
  });

  it('drops removed keys from the legacy list so it only shrinks', () => {
    const registry = new Set(collectRegistryKeys());
    const stale = LEGACY_SWR_KEYS.filter((key) => !registry.has(key));

    expect(stale, 'Remove these entries from LEGACY_SWR_KEYS.').toEqual([]);
  });
});
