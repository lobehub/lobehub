import { type labPreferSelectors } from '@/store/user/slices/preference/selectors/labPrefer';

/**
 * Maturity stage of a lab experiment:
 * - alpha: internal testing only, not recommended for daily use yet
 * - beta: relatively usable — core flow works, details still being polished
 */
export type LabStage = 'alpha' | 'beta';

/**
 * Locale key stems under the `labs` namespace (`features.${stem}.title|desc`),
 * listed as literals so the dynamic `t()` calls stay inside the typed key union.
 */
type LabFeatureI18nKey =
  | 'agentGraphConfig'
  | 'agentProviderBinding'
  | 'artifactDeployment'
  | 'claudeCodeSdk'
  | 'codexAppServer'
  | 'desktopSplitView'
  | 'heteroSessionImport'
  | 'imessage'
  | 'inAppBrowser'
  | 'inputMarkdown'
  | 'messageTextSelectionActions'
  | 'oauthApps'
  | 'projects'
  | 'selfLearning'
  | 'topicAcceptance';

export interface LabFeatureItem {
  /** Only rendered (and searchable) in the Electron shell */
  desktopOnly?: boolean;
  /** Lab flag, also the search anchor suffix (`labs-${flag}`) */
  flag: keyof typeof labPreferSelectors;
  /** Locale key stem in the `labs` namespace: `features.${i18nKey}.title|desc` */
  i18nKey: LabFeatureI18nKey;
  /** Extra untranslated English synonyms for the settings search index */
  searchKeywords: string[];
  stage: LabStage;
}

/**
 * Single source of truth for the lab experiments: the Labs settings page
 * renders this list (general first, then desktop-only), and the settings
 * search index derives its entries from it — adding a flag here makes it both
 * visible and searchable without a second registration.
 */
export const LAB_FEATURES: LabFeatureItem[] = [
  {
    flag: 'enableAgentGraphConfig',
    i18nKey: 'agentGraphConfig',
    searchKeywords: ['agent graph', 'graph runtime'],
    stage: 'alpha',
  },
  {
    flag: 'enableInputMarkdown',
    i18nKey: 'inputMarkdown',
    searchKeywords: ['markdown', 'input markdown'],
    stage: 'beta',
  },
  {
    flag: 'enableMessageTextSelectionActions',
    i18nKey: 'messageTextSelectionActions',
    searchKeywords: ['text selection', 'quote'],
    stage: 'alpha',
  },
  {
    flag: 'enableSelfLearning',
    i18nKey: 'selfLearning',
    searchKeywords: ['self-evolving', 'self learning', 'rule base'],
    stage: 'alpha',
  },
  {
    flag: 'enableTopicAcceptance',
    i18nKey: 'topicAcceptance',
    searchKeywords: ['acceptance', 'checklist'],
    stage: 'alpha',
  },
  {
    flag: 'enableProjects',
    i18nKey: 'projects',
    searchKeywords: ['project', 'workspace'],
    stage: 'alpha',
  },
  {
    flag: 'enableOAuthApps',
    i18nKey: 'oauthApps',
    searchKeywords: ['oauth', 'oauth apps'],
    stage: 'beta',
  },
  {
    flag: 'enableArtifactDeployment',
    i18nKey: 'artifactDeployment',
    searchKeywords: ['artifact', 'deploy', 'publish'],
    stage: 'beta',
  },
  {
    desktopOnly: true,
    flag: 'enableDesktopSplitView',
    i18nKey: 'desktopSplitView',
    searchKeywords: ['split view', 'split tab'],
    stage: 'alpha',
  },
  {
    desktopOnly: true,
    flag: 'enableImessage',
    i18nKey: 'imessage',
    searchKeywords: ['imessage', 'bluebubbles'],
    stage: 'alpha',
  },
  {
    desktopOnly: true,
    flag: 'enableAgentProviderBinding',
    i18nKey: 'agentProviderBinding',
    searchKeywords: ['agent provider binding', 'claude code api', 'codex api', 'api provider'],
    stage: 'alpha',
  },
  {
    desktopOnly: true,
    flag: 'enableClaudeCodeSdk',
    i18nKey: 'claudeCodeSdk',
    searchKeywords: ['claude code', 'claude sdk'],
    stage: 'alpha',
  },
  {
    desktopOnly: true,
    flag: 'enableCodexAppServer',
    i18nKey: 'codexAppServer',
    searchKeywords: ['codex', 'app server'],
    stage: 'alpha',
  },
  // rides on the Claude Code hetero-agent stack: scans local CLI transcripts
  // via the Electron main process — desktop only
  {
    desktopOnly: true,
    flag: 'enableHeteroSessionImport',
    i18nKey: 'heteroSessionImport',
    searchKeywords: ['import session', 'claude code', 'codex'],
    stage: 'beta',
  },
  {
    desktopOnly: true,
    flag: 'enableInAppBrowser',
    i18nKey: 'inAppBrowser',
    searchKeywords: ['in-app browser', 'inapp browser', 'embedded browser', 'browser tab'],
    stage: 'beta',
  },
];
