import type { HighlighterProps, MermaidProps, NeutralColors, PrimaryColors } from '@lobehub/ui';

import type { ResponseAnimationStyle } from '../../aiProvider';

export type AnimationMode = 'disabled' | 'agile' | 'elegant';

export type ContextMenuMode = 'disabled' | 'default';

export interface UserGeneralConfig {
  animationMode?: AnimationMode;
  contextMenuMode?: ContextMenuMode;
  fontSize: number;
  highlighterTheme?: HighlighterProps['theme'];
  isDevMode: boolean;
  isLiteMode: boolean;
  mermaidTheme?: MermaidProps['theme'];
  neutralColor?: NeutralColors;
  primaryColor?: PrimaryColors;
  responseLanguage?: string;
  telemetry: boolean;
  transitionMode?: ResponseAnimationStyle;
}
