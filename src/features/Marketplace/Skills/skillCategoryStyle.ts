import {
  Apple,
  AudioLines,
  BookOpen,
  CalendarDays,
  Car,
  ChartColumn,
  CircleCheck,
  Clapperboard,
  Cloud,
  Code,
  FileText,
  Gamepad2,
  GitBranch,
  Globe,
  HeartPulse,
  House,
  Image,
  type LucideIcon,
  Megaphone,
  MessagesSquare,
  Network,
  NotebookPen,
  PanelsTopLeft,
  Search,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Sprout,
  SquareTerminal,
  Wallet,
  Workflow,
  Wrench,
} from 'lucide-react';

/** Grainient takes hex stops, so a hue is three of them plus the solid tile color. */
interface Hue {
  /**
   * Stops for the gradient behind a skill's preview: two neighboring shades of
   * the hue around its base, so the blend stays calm rather than two-toned.
   */
  gradient: [string, string, string];
  /** Solid background of the skill's icon tile; the glyph on it is white. */
  tile: string;
}

const HUES = {
  amber: { gradient: ['#FCC53A', '#F59E0B', '#F7A21B'], tile: '#D9930D' },
  blue: { gradient: ['#60A5FA', '#3B82F6', '#4F7CF7'], tile: '#3B7BEA' },
  cyan: { gradient: ['#22D3EE', '#06B6D4', '#0EA5E9'], tile: '#0E9EBF' },
  green: { gradient: ['#4ADE80', '#22C55E', '#16A34A'], tile: '#2E9A57' },
  indigo: { gradient: ['#818CF8', '#6366F1', '#7C6CF2'], tile: '#5B5BD6' },
  orange: { gradient: ['#FB923C', '#F97316', '#F05A28'], tile: '#EE8530' },
  pink: { gradient: ['#F472B6', '#EC4899', '#F0508A'], tile: '#C94B85' },
  purple: { gradient: ['#A78BFA', '#8B5CF6', '#9F5CF0'], tile: '#7C5CDB' },
  red: { gradient: ['#F87171', '#EF4444', '#F2553C'], tile: '#DC4A4F' },
  slate: { gradient: ['#94A3B8', '#64748B', '#6B7A90'], tile: '#5F6B7A' },
  teal: { gradient: ['#2DD4BF', '#14B8A6', '#10B981'], tile: '#13998A' },
} satisfies Record<string, Hue>;

type HueName = keyof typeof HUES;

/** Each Market skill category's hue and glyph, keyed by `SkillCategory` value. */
const CATEGORY_STYLE: Record<string, { hue: HueName; icon: LucideIcon }> = {
  'agent-to-agent-protocols': { hue: 'indigo', icon: Network },
  'ai-llms': { hue: 'purple', icon: Sparkles },
  'apple-apps-services': { hue: 'slate', icon: Apple },
  'browser-automation': { hue: 'blue', icon: Globe },
  'calendar-scheduling': { hue: 'orange', icon: CalendarDays },
  'cli-utilities': { hue: 'slate', icon: SquareTerminal },
  'clawdbot-tools': { hue: 'red', icon: Wrench },
  'coding-agents-ides': { hue: 'indigo', icon: Code },
  'communication': { hue: 'teal', icon: MessagesSquare },
  'data-analytics': { hue: 'blue', icon: ChartColumn },
  'devops-cloud': { hue: 'cyan', icon: Cloud },
  'finance': { hue: 'green', icon: Wallet },
  'gaming': { hue: 'pink', icon: Gamepad2 },
  'git-github': { hue: 'orange', icon: GitBranch },
  'health-fitness': { hue: 'green', icon: HeartPulse },
  'image-video-generation': { hue: 'pink', icon: Image },
  'ios-macos-development': { hue: 'blue', icon: Smartphone },
  'marketing-sales': { hue: 'amber', icon: Megaphone },
  'media-streaming': { hue: 'red', icon: Clapperboard },
  'moltbook': { hue: 'amber', icon: BookOpen },
  'notes-pkm': { hue: 'amber', icon: NotebookPen },
  'pdf-documents': { hue: 'purple', icon: FileText },
  'personal-development': { hue: 'teal', icon: Sprout },
  'productivity-tasks': { hue: 'orange', icon: CircleCheck },
  'search-research': { hue: 'blue', icon: Search },
  'security-passwords': { hue: 'green', icon: ShieldCheck },
  'self-hosted-automation': { hue: 'cyan', icon: Workflow },
  'shopping-ecommerce': { hue: 'pink', icon: ShoppingBag },
  'smart-home-iot': { hue: 'teal', icon: House },
  'speech-transcription': { hue: 'purple', icon: AudioLines },
  'transportation': { hue: 'blue', icon: Car },
  'web-frontend-development': { hue: 'cyan', icon: PanelsTopLeft },
};

export interface SkillCategoryStyle extends Hue {
  icon: LucideIcon;
}

/** A category's tile color, gradient and glyph; `undefined` for none or an unknown one. */
export const getSkillCategoryStyle = (category?: string | null): SkillCategoryStyle | undefined => {
  const style = category ? CATEGORY_STYLE[category] : undefined;
  if (!style) return undefined;
  return { ...HUES[style.hue], icon: style.icon };
};

/** The gradient behind a skill that has no category to color it. */
export const DEFAULT_SKILL_GRADIENT: Hue['gradient'] = HUES.slate.gradient;
