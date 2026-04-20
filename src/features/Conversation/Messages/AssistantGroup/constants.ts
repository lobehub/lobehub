/**
 * Assistant group / workflow UI — tunable limits, timing, heuristics, and apiName display labels.
 * Centralizes magic numbers used by Group, WorkflowCollapse, and toolDisplayNames helpers.
 */

// ─── Workflow collapse (WorkflowCollapse) ─────────────────────────────────

/** Elapsed timer in the working header only appears after this many ms (aligns with ContentLoading). */
export const WORKFLOW_WORKING_ELAPSED_SHOW_AFTER_MS = 2100;

/** Debounce when B/C headline text changes to avoid streaming arg chunks thrashing the title animation. */
export const WORKFLOW_HEADLINE_DEBOUNCE_MS = 320;

/** After prose forms a complete sentence (trailing CJK/Latin punct), commit headline after this delay. */
export const WORKFLOW_PROSE_QUICK_COMMIT_MS = 280;

/** Partial prose without sentence end: commit headline after this idle delay. */
export const WORKFLOW_PROSE_IDLE_COMMIT_MS = 680;

/** Min height (px) for the streaming title row to reduce layout shift during motion. */
export const WORKFLOW_STREAMING_TITLE_MIN_HEIGHT_PX = 22;

/** Pixels from bottom of scroll port: auto-scroll in expanded workflow list stays active within this margin. */
export const WORKFLOW_EXPANDED_SCROLL_THRESHOLD_PX = 120;

// ─── One-line prose headline shaping ─────────────────────────────────────────

/** Hard cap for shaped workflow title before word-boundary ellipsis. */
export const WORKFLOW_PROSE_HEADLINE_MAX_CHARS = 100;

/** Ignore very short fragments; also minimum for “valid” sentence after cut. */
export const WORKFLOW_PROSE_MIN_CHARS = 8;

/** Minimum trimmed `content` length when picking a block for live headline source. */
export const WORKFLOW_PROSE_SOURCE_MIN_CHARS = 8;

/**
 * List-marker junk filter: reject single-line bodies like "- a" from being a headline
 * (max word chars after list marker).
 */
export const WORKFLOW_PROSE_LIST_MARKER_MAX_TAIL_WORD_CHARS = 3;

/** When truncating at space, require last space to be at least this fraction of max (avoid tiny cuts). */
export const WORKFLOW_TRUNCATE_WORD_BOUNDARY_MIN_RATIO = 0.55;

/** Strip markdown headings: match ATX `#` up to this many levels. */
export const WORKFLOW_MARKDOWN_HEADING_MAX_LEVEL = 6;

// ─── Tool argument / step lines (headline B/C and summaries) ───────────────

/** First string tool argument preview: show at most this many chars before "…". */
export const TOOL_FIRST_DETAIL_MAX_CHARS = 80;

/** Tool step / arg combined headline: soft cap for readable one-liner. */
export const TOOL_HEADLINE_DETAIL_MAX_CHARS = 120;

/** Slice length before appending ellipsis when over TOOL_HEADLINE_DETAIL_MAX_CHARS (room for "..."). */
export const TOOL_HEADLINE_DETAIL_TRUNCATE_LEN = 117;

/** Suffix when truncating tool strings. */
export const TOOL_HEADLINE_TRUNCATION_SUFFIX = '...';

// ─── Post-tool “final answer” block promotion (Group partition) ───────────

/** Sum of heuristic scores at or above this promotes visible prose out of workflow chrome. */
export const POST_TOOL_FINAL_ANSWER_SCORE_THRESHOLD = 3;

/** Add this score when compacted prose length ≥ this (long answer signal). */
export const POST_TOOL_ANSWER_LENGTH_LONG_SCORE = 2;

/** Lower bound (chars) for POST_TOOL_ANSWER_LENGTH_LONG_SCORE. */
export const POST_TOOL_ANSWER_LENGTH_LONG_MIN_CHARS = 180;

/** Add this score when length ∈ [medium min, long min). */
export const POST_TOOL_ANSWER_MEDIUM_TEXT_SCORE = 1;

/** Lower bound (chars) for medium-length contribution. */
export const POST_TOOL_ANSWER_LENGTH_MEDIUM_MIN_CHARS = 100;

/** Blank-line paragraphing: strong signal for structured deliverable. */
export const POST_TOOL_ANSWER_DOUBLE_NEWLINE_SCORE = 2;

/** Without \\n\\n, treat many non-empty lines as paragraphing when count ≥ this. */
export const POST_TOOL_ANSWER_MULTI_LINE_SCORE = 2;

/** Minimum trimmed lines (with at least one non-empty) to count as multi-line body. */
export const POST_TOOL_ANSWER_MULTI_LINE_MIN_COUNT = 3;

/** Markdown heading or list at line start: structured deliverable. */
export const POST_TOOL_ANSWER_MARKDOWN_STRUCTURE_SCORE = 2;

/** Add one point when sentence-ending punctuation count ≥ this (compact text). */
export const POST_TOOL_ANSWER_PUNCT_MIN_COUNT = 3;

export const POST_TOOL_ANSWER_PUNCT_SCORE = 1;

// ─── Time formatting (workflow summary / reasoning suffix) ───────────────

/** Seconds per minute when formatting durations like "2m 30s". */
export const DURATION_SECONDS_PER_MINUTE = 60;

/** Duration inputs are in milliseconds; convert to whole seconds for display. */
export const TIME_MS_PER_SECOND = 1000;

// ─── apiName → i18n key for human-readable label (workflow summary & headlines) ─

/** Translation keys for built-in / known tool api names. Unknown api names use title-cased fallback. */
export const TOOL_API_DISPLAY_NAMES: Record<string, string> = {
  // Web browsing
  crawlMultiPages: 'workflow.toolDisplayName.crawlMultiPages',
  crawlSinglePage: 'workflow.toolDisplayName.crawlSinglePage',
  search: 'workflow.toolDisplayName.search',

  // Knowledge base
  readKnowledge: 'workflow.toolDisplayName.readKnowledge',
  searchKnowledgeBase: 'workflow.toolDisplayName.searchKnowledgeBase',

  // Notebook
  createDocument: 'workflow.toolDisplayName.createDocument',
  deleteDocument: 'workflow.toolDisplayName.deleteDocument',
  getDocument: 'workflow.toolDisplayName.getDocument',
  updateDocument: 'workflow.toolDisplayName.updateDocument',

  // Agent documents
  copyDocument: 'workflow.toolDisplayName.copyDocument',
  editDocument: 'workflow.toolDisplayName.editDocument',
  listDocuments: 'workflow.toolDisplayName.listDocuments',
  readDocument: 'workflow.toolDisplayName.readDocument',
  readDocumentByFilename: 'workflow.toolDisplayName.readDocumentByFilename',
  removeDocument: 'workflow.toolDisplayName.removeDocument',
  renameDocument: 'workflow.toolDisplayName.renameDocument',
  upsertDocumentByFilename: 'workflow.toolDisplayName.upsertDocumentByFilename',
  updateLoadRule: 'workflow.toolDisplayName.updateLoadRule',

  // Calculator
  calculate: 'workflow.toolDisplayName.calculate',
  evaluate: 'workflow.toolDisplayName.evaluate',
  solve: 'workflow.toolDisplayName.solve',
  execute: 'workflow.toolDisplayName.execute',

  // Local system
  editLocalFile: 'workflow.toolDisplayName.editLocalFile',
  globLocalFiles: 'workflow.toolDisplayName.globLocalFiles',
  grepContent: 'workflow.toolDisplayName.grepContent',
  killCommand: 'workflow.toolDisplayName.killCommand',
  listLocalFiles: 'workflow.toolDisplayName.listLocalFiles',
  moveLocalFiles: 'workflow.toolDisplayName.moveLocalFiles',
  readLocalFile: 'workflow.toolDisplayName.readLocalFile',
  renameLocalFile: 'workflow.toolDisplayName.renameLocalFile',
  runCommand: 'workflow.toolDisplayName.runCommand',
  searchLocalFiles: 'workflow.toolDisplayName.searchLocalFiles',
  writeLocalFile: 'workflow.toolDisplayName.writeLocalFile',
  getCommandOutput: 'workflow.toolDisplayName.getCommandOutput',

  // Cloud sandbox
  executeCode: 'workflow.toolDisplayName.executeCode',

  // GTD
  createPlan: 'workflow.toolDisplayName.createPlan',
  createTodos: 'workflow.toolDisplayName.createTodos',
  updatePlan: 'workflow.toolDisplayName.updatePlan',
  updateTodos: 'workflow.toolDisplayName.updateTodos',
  clearTodos: 'workflow.toolDisplayName.clearTodos',
  execTask: 'workflow.toolDisplayName.execTask',
  execTasks: 'workflow.toolDisplayName.execTasks',

  // Memory
  addActivityMemory: 'workflow.toolDisplayName.addActivityMemory',
  addContextMemory: 'workflow.toolDisplayName.addContextMemory',
  addExperienceMemory: 'workflow.toolDisplayName.addExperienceMemory',
  addIdentityMemory: 'workflow.toolDisplayName.addIdentityMemory',
  addPreferenceMemory: 'workflow.toolDisplayName.addPreferenceMemory',
  removeIdentityMemory: 'workflow.toolDisplayName.removeIdentityMemory',
  searchUserMemory: 'workflow.toolDisplayName.searchUserMemory',
  updateIdentityMemory: 'workflow.toolDisplayName.updateIdentityMemory',

  // Agent management
  callAgent: 'workflow.toolDisplayName.callAgent',
  createAgent: 'workflow.toolDisplayName.createAgent',
  deleteAgent: 'workflow.toolDisplayName.deleteAgent',
  searchAgent: 'workflow.toolDisplayName.searchAgent',
  updateAgent: 'workflow.toolDisplayName.updateAgent',

  // Page agent
  editTitle: 'workflow.toolDisplayName.editTitle',
  getPageContent: 'workflow.toolDisplayName.getPageContent',
  initPage: 'workflow.toolDisplayName.initPage',
  modifyNodes: 'workflow.toolDisplayName.modifyNodes',
  replaceText: 'workflow.toolDisplayName.replaceText',

  // Skills
  activateSkill: 'workflow.toolDisplayName.activateSkill',
  activateTools: 'workflow.toolDisplayName.activateTools',
  execScript: 'workflow.toolDisplayName.execScript',

  // Skill store
  importFromMarket: 'workflow.toolDisplayName.importFromMarket',
  importSkill: 'workflow.toolDisplayName.importSkill',
  searchSkill: 'workflow.toolDisplayName.searchSkill',

  // Misc
  finishOnboarding: 'workflow.toolDisplayName.finishOnboarding',
  getOnboardingState: 'workflow.toolDisplayName.getOnboardingState',
  getTopicContext: 'workflow.toolDisplayName.getTopicContext',
  listOnlineDevices: 'workflow.toolDisplayName.listOnlineDevices',
  activateDevice: 'workflow.toolDisplayName.activateDevice',
};
