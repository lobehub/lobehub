import { type BriefType } from '@lobechat/types';
import { type LucideIcon } from 'lucide-react';
import { AlertCircle, CheckCircle2, CircleDot, Lightbulb } from 'lucide-react';

export const COLLAPSED_MAX_HEIGHT = 100;

// Colors: use cssVar semantic tokens where available, hex for types without a token.
// decision (purple) and insight (blue) have no cssVar equivalent — use antd palette hex.
export const BRIEF_TYPE_COLOR: Record<BriefType, string | undefined> = {
  decision: '#722ED1',
  error: undefined, // use cssVar.colorError at render
  insight: '#2F54EB',
  result: undefined, // use cssVar.colorSuccess at render
};

export const BRIEF_TYPE_ICON: Record<BriefType, LucideIcon> = {
  decision: CircleDot,
  error: AlertCircle,
  insight: Lightbulb,
  result: CheckCircle2,
};
