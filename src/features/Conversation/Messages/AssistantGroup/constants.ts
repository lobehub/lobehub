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

/** Sum of heuristic scores at or above this moves blocks after last tool into answer column while generating. */
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

// ─── apiName → past-tense human-readable label (workflow summary & headlines) ─

/** Past-tense labels for built-in / known tool api names. Unknown api names use title-cased fallback. */
export const TOOL_API_DISPLAY_NAMES: Record<string, string> = {
  // Web browsing
  crawlMultiPages: 'Crawled pages',
  crawlSinglePage: 'Crawled a page',
  search: 'Searched the web',

  // Knowledge base
  readKnowledge: 'Read knowledge',
  searchKnowledgeBase: 'Searched knowledge base',

  // Notebook
  createDocument: 'Created a document',
  deleteDocument: 'Deleted a document',
  getDocument: 'Read a document',
  updateDocument: 'Updated a document',

  // Agent documents
  copyDocument: 'Copied a document',
  editDocument: 'Edited a document',
  listDocuments: 'Listed documents',
  readDocument: 'Read a document',
  readDocumentByFilename: 'Read a document',
  removeDocument: 'Removed a document',
  renameDocument: 'Renamed a document',
  upsertDocumentByFilename: 'Updated a document',
  updateLoadRule: 'Updated load rule',

  // Calculator
  calculate: 'Calculated',
  evaluate: 'Evaluated expression',
  solve: 'Solved equation',
  execute: 'Executed calculation',

  // Local system
  editLocalFile: 'Edited a file',
  globLocalFiles: 'Searched files',
  grepContent: 'Searched content',
  killCommand: 'Stopped a command',
  listLocalFiles: 'Listed files',
  moveLocalFiles: 'Moved files',
  readLocalFile: 'Read a file',
  renameLocalFile: 'Renamed a file',
  runCommand: 'Ran a command',
  searchLocalFiles: 'Searched files',
  writeLocalFile: 'Wrote a file',
  getCommandOutput: 'Read command output',

  // Cloud sandbox
  executeCode: 'Executed code',

  // GTD
  createPlan: 'Created a plan',
  createTodos: 'Created todos',
  updatePlan: 'Updated plan',
  updateTodos: 'Updated todos',
  clearTodos: 'Cleared todos',
  execTask: 'Executed a task',
  execTasks: 'Executed tasks',

  // Memory
  addActivityMemory: 'Saved memory',
  addContextMemory: 'Saved memory',
  addExperienceMemory: 'Saved memory',
  addIdentityMemory: 'Saved memory',
  addPreferenceMemory: 'Saved memory',
  removeIdentityMemory: 'Removed memory',
  searchUserMemory: 'Searched memory',
  updateIdentityMemory: 'Updated memory',

  // Agent management
  callAgent: 'Called an agent',
  createAgent: 'Created an agent',
  deleteAgent: 'Deleted an agent',
  searchAgent: 'Searched agents',
  updateAgent: 'Updated an agent',

  // Page agent
  editTitle: 'Edited title',
  getPageContent: 'Read page content',
  initPage: 'Initialized page',
  modifyNodes: 'Modified page',
  replaceText: 'Replaced text',

  // Skills
  activateSkill: 'Activated a skill',
  activateTools: 'Activated tools',
  execScript: 'Executed a script',

  // Skill store
  importFromMarket: 'Imported from market',
  importSkill: 'Imported a skill',
  searchSkill: 'Searched skills',

  // Misc
  finishOnboarding: 'Finished onboarding',
  getOnboardingState: 'Checked onboarding state',
  getTopicContext: 'Read topic context',
  listOnlineDevices: 'Listed devices',
  activateDevice: 'Activated device',
};
