import type { HighlighterProps, LobePrimaryColor, MermaidProps, NeutralColors } from '@lobehub/ui';

import type { ResponseAnimationStyle } from '../../aiProvider';

export type AnimationMode = 'disabled' | 'agile' | 'elegant';

export type ContextMenuMode = 'disabled' | 'default';

/**
 * What a message sent while the agent runs does (Better Coding Experience
 * lab): `queue` waits for the run to end and sends one message per turn;
 * `steer` joins the running turn at a point the agent picks.
 */
export type FollowUpBehavior = 'queue' | 'steer';

/** The behavior in effect: `legacy` while the lab is off (the setting is not read). */
export type FollowUpMode = FollowUpBehavior | 'legacy';

/** Resolve the behavior in effect from the lab switch and the stored setting. */
export const resolveFollowUpMode = (
  labEnabled: boolean | undefined,
  setting: FollowUpBehavior | undefined,
): FollowUpMode => (labEnabled ? (setting ?? 'steer') : 'legacy');

export interface UserGeneralConfig {
  animationMode?: AnimationMode;
  contextMenuMode?: ContextMenuMode;
  costEstimateWarningThreshold?: number;
  /**
   * Whether to auto-scroll during AI streaming output
   * @default true
   */
  enableAutoScrollOnStreaming?: boolean;
  /**
   * Whether to show the website/favicon icon before links in chat messages.
   * Turning it off renders plain links, which copy cleanly into email and other apps.
   * @default true
   */
  enableMessageLinkIcon?: boolean;
  /**
   * Whether Markdown pasted into the chat input is converted into rich text.
   * Off keeps the pasted text verbatim.
   * @default true
   */
  enablePasteAutoConvert?: boolean;
  /**
   * Whether a turn's tool workflow starts expanded while the agent is still
   * running. Off keeps the running turn to a single live headline row.
   * @default false
   */
  expandWorkflowWhileStreaming?: boolean;
  /**
   * Messages sent while the agent runs; read only with the Better Coding
   * Experience lab on.
   * @default 'steer'
   */
  followUpBehavior?: FollowUpBehavior;
  /**
   * Grayscale font antialiasing on macOS. Off falls back to the system default rendering.
   * @default true
   */
  fontAntialiasing?: boolean;
  fontSize: number;
  highlighterTheme?: HighlighterProps['theme'];
  isDevMode: boolean;
  isLiteMode: boolean;
  mermaidTheme?: MermaidProps['theme'];
  neutralColor?: NeutralColors;
  primaryColor?: LobePrimaryColor;
  responseLanguage?: string;
  /**
   * Whether a tool call that only reads an image (e.g. Claude Code `Read` of a
   * PNG) gets its own row with the image expanded. Off folds it into the
   * "N calls" collapse like any other call, collapsed until clicked.
   * @default true
   */
  showImageReadPreview?: boolean;
  telemetry: boolean;
  timezone?: string;
  transitionMode?: ResponseAnimationStyle;
}
