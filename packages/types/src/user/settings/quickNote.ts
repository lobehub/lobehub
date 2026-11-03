/** Automatic Analyze behavior for saved Quick Notes. */
export interface QuickNoteAutoAnalyzeSettings {
  /** Whether a saved non-empty Note is analyzed after its quiet period. @default true */
  enabled: boolean;
  /** Quiet period after the latest durable edit, in milliseconds. @default 6000 */
  idleDelayMs: number;
}

/** User-level bindings and execution limits for Quick Note processing. */
export interface UserQuickNoteSettings {
  /**
   * Agent used for Analyze Runs. `null` resolves to the configurable builtin
   * Quick Note Analyzer.
   * @default null
   */
  analyzeAgentId: string | null;
  /** Automatic Analyze scheduling preferences. */
  autoAnalyze: QuickNoteAutoAnalyzeSettings;
  /** Maximum steps available to Analyze so configured tools can complete. @default 4 */
  maxAnalyzeSteps: number;
}
