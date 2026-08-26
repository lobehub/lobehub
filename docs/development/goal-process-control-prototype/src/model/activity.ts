// Activity event model — the feed is type-driven. Every row is an ActivityEvent whose `kind` comes
// from one of the sources below; `kind` alone decides icon, tone and where the node chip points.
//
//   Source (production)                     → kind                      → who
//   goal_events  created (node/goal)        → create                    Agent / 系统
//   coordinator  runTask (attempt started)  → start                     系统
//   task topic   last tool line / heartbeat → progress (optional, live) builder agent
//   verify run   passed                     → pass                      verifier
//   verify run   failed                     → fail                      verifier
//   lease        abandoned / lease_expired  → abandon                   系统
//   goal_nodes   finding created            → finding                   系统
//   decisions    opened / resolved          → decision                  系统 / 你 / Agent
//   goal         paused (budget or user)    → pause                     系统 / 你
//   goal         resumed / started          → resume                    你
//   goal         setBudget                  → budget                    你
//   task comment                            → comment                   你
//   goal         achieved                   → achieved                  你 (D1) / 系统
//
// Work lifecycle that emits them (one Work):
//   proposed ─start→ active ─pass→ resolved ─finding→ (next Work unlocks)
//                      │ ─fail→ active (auto retry)  ─fail (attempts exhausted)→ waiting ─decision→ active | retired
//                      │ ─abandon→ active (replacement)
//   goal: running ─pause(budget/user)→ paused ─resume/budget→ running ; review ─decision→ running ; verifying ─pass→ review ─achieved

import type { LucideIcon } from 'lucide-react';
import {
  Check,
  Coins,
  GitBranch,
  Lightbulb,
  MessageSquare,
  Pause,
  Play,
  Sparkles,
  Trophy,
  WifiOff,
  X,
} from 'lucide-react';

import type { ActivityKind } from '../types';

export type ActivityTone = 'neutral' | 'ok' | 'bad' | 'warn';

export interface ActivityMeta {
  icon: LucideIcon;
  tone: ActivityTone;
  /** Human label of the kind, for legends / filters. */
  label: string;
}

export const ACTIVITY_META: Record<ActivityKind, ActivityMeta> = {
  create: { icon: Sparkles, tone: 'neutral', label: '创建' },
  start: { icon: Play, tone: 'neutral', label: '开始尝试' },
  progress: { icon: Play, tone: 'neutral', label: '进展' },
  pass: { icon: Check, tone: 'ok', label: '验证通过' },
  fail: { icon: X, tone: 'bad', label: '验证未通过' },
  abandon: { icon: WifiOff, tone: 'bad', label: '失联回收' },
  finding: { icon: Lightbulb, tone: 'ok', label: '沉淀结论' },
  decision: { icon: GitBranch, tone: 'warn', label: '决策' },
  budget: { icon: Coins, tone: 'warn', label: '预算' },
  pause: { icon: Pause, tone: 'warn', label: '暂停' },
  resume: { icon: Play, tone: 'neutral', label: '继续' },
  comment: { icon: MessageSquare, tone: 'neutral', label: '说明' },
  achieved: { icon: Trophy, tone: 'ok', label: '达成' },
};

export const ACTIVITY_KINDS = Object.keys(ACTIVITY_META) as ActivityKind[];
