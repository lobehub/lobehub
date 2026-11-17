import { Plans } from '@lobechat/types';

// lobe-design-ignore-file LOBE-RAW-COLOR: tier badge palettes are brand art that must stay identical in light and dark themes; no cssVar token carries them

export interface PlanTheme {
  background?: string;
  color?: string;
}

export const themes = {
  [Plans.Free]: {
    theme: {
      background: undefined,
      color: undefined,
    },
  },
  [Plans.Hobby]: {
    theme: {
      background: 'linear-gradient(45deg, #21B2EE, #2271ED)',
      color: '#E5F8FF',
    },
  },
  [Plans.Starter]: {
    theme: {
      background: 'linear-gradient(45deg, #C57948, #803718)',
      color: '#FFC385',
    },
  },
  [Plans.Premium]: {
    theme: {
      background: 'linear-gradient(45deg, #A5B4C2, #606E7B)',
      color: '#FCFDFF',
    },
  },
  [Plans.Ultimate]: {
    theme: {
      background: 'linear-gradient(45deg, #F7A82F, #BB7227)',
      color: '#FCFA6E',
    },
  },
  [Plans.Plus]: {
    theme: {
      // lobe-design-ignore LOBE-PURPLE-GRADIENT: categorical hue that tells the Plus tier apart from the other tier badges, not a decorative hero gradient
      background: 'linear-gradient(45deg, #8B5CF6, #5B21B6)',
      color: '#EDE9FE',
    },
  },
  [Plans.Pro]: {
    theme: {
      background: 'linear-gradient(45deg, #10B981, #047857)',
      color: '#D1FAE5',
    },
  },
  [Plans.Max]: {
    theme: {
      background: 'linear-gradient(45deg, #374151, #111827)',
      color: '#FDE68A',
    },
  },
} satisfies Record<Plans, { theme: PlanTheme }>;

/**
 * The badge palette of a personal plan. The plan value comes from the server, so an
 * installed desktop build can receive a plan launched after it shipped; such a plan
 * gets the neutral Free palette instead of crashing the renderer.
 */
export const getPlanTheme = (plan: string | null | undefined): PlanTheme =>
  (plan && Object.hasOwn(themes, plan) ? themes[plan as Plans] : themes[Plans.Free]).theme;

/**
 * Display name for a plan this build has no `plans.plan.<id>.title` locale key for:
 * the plan id with its first letter capitalized (`basic` → `Basic`).
 */
export const getUnknownPlanTitle = (plan: string): string =>
  plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : plan;
