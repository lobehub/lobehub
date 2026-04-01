import { AlertCircle, CheckCircle2, CircleDot, Lightbulb } from 'lucide-react';

export const COLLAPSED_MAX_HEIGHT = 100;

// Colors: use cssVar semantic tokens where available, hex for types without a token.
// decision (purple) and insight (blue) have no cssVar equivalent — use antd palette hex.
export const BRIEF_TYPE_COLOR = {
  decision: '#722ED1',
  error: undefined, // use cssVar.colorError at render
  insight: '#2F54EB',
  result: undefined, // use cssVar.colorSuccess at render
} as const;

export const BRIEF_TYPE_ICON: Record<string, typeof CircleDot> = {
  decision: CircleDot,
  error: AlertCircle,
  insight: Lightbulb,
  result: CheckCircle2,
};
