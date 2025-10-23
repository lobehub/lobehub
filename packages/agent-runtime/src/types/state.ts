/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
import type { Cost, CostLimit, Usage } from './usage';

/**
 * Agent's serializable state.
 * This is the "passport" that can be persisted and transferred.
 */
export interface AgentState {
  sessionId: string;
  // --- State Machine ---
  status: 'idle' | 'running' | 'waiting_for_human' | 'done' | 'error' | 'interrupted';

  // --- Core Context ---
  messages: any[];
  tools?: any[];
  systemRole?: string;
  toolManifestMap: Record<string, any>;
  // --- Execution Tracking ---
  /**
   * Number of execution steps in this session.
   * Incremented on each runtime.step() call.
   */
  stepCount: number;
  /**
   * Optional maximum number of steps allowed.
   * If set, execution will stop with error when exceeded.
   */
  maxSteps?: number;

  // --- Usage and Cost Tracking ---
  /**
   * Accumulated usage statistics for this session.
   * Tracks tokens, API calls, tool usage, etc.
   */
  usage: Usage;
  /**
   * Current calculated cost for this session.
   * Updated after each billable operation.
   */
  cost: Cost;
  /**
   * Optional cost limits configuration.
   * If set, execution will stop when limits are exceeded.
   */
  costLimit?: CostLimit;

  // --- HIL ---
  /**
   * When status is 'waiting_for_human', this stores pending requests
   * for human-in-the-loop operations.
   */
  pendingToolsCalling?: ToolsCalling[];
  pendingHumanPrompt?: { metadata?: Record<string, unknown>; prompt: string };
  pendingHumanSelect?: {
    metadata?: Record<string, unknown>;
    multi?: boolean;
    options: Array<{ label: string; value: string }>;
    prompt?: string;
  };

  // --- Interruption Handling ---
  /**
   * When status is 'interrupted', this stores the interruption context
   * for potential resumption or cleanup.
   */
  interruption?: {
    /** Reason for interruption */
    reason: string;
    /** Timestamp when interruption occurred */
    interruptedAt: string;
    /** The instruction that was being executed when interrupted */
    interruptedInstruction?: any;
    /** Whether the interruption can be resumed */
    canResume: boolean;
  };

  // --- Metadata ---
  createdAt: string;
  error?: any;
  lastModified: string;

  // --- Extensible metadata ---
  metadata?: Record<string, any>;
}

/**
 * OpenAI Tool Call
 */
export interface ToolsCalling {
  function: {
    arguments: string;
    name: string; // A JSON string of arguments
  };
  id: string;
  type: 'function';
}

/**
 * A registry for tools, mapping tool names to their implementation.
 */
export type ToolRegistry = Record<string, (args: any) => Promise<any>>;
