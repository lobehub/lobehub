import { Figma, Notion, Vercel, Zapier } from '@lobehub/icons';
import type { ComponentType } from 'react';

/** Stable id of an integration; doubles as its settings sub-route (`/settings/integrations/<id>`). */
export type IntegrationId = 'github';

export interface IntegrationDefinition {
  /** Documentation page for the integration. */
  docsUrl: string;
  /** Brand mark, rendered at the size the host passes. */
  icon: ComponentType<{ size?: number; style?: React.CSSProperties }>;
  id: IntegrationId;
  /** Display name — brand names are not translated. */
  name: string;
}

/**
 * Every integration the settings page knows about, in display order. The
 * page reads connection state per integration through its own hook; this
 * list only says what exists and how to find it.
 */
export const INTEGRATIONS: IntegrationDefinition[] = [];

export const registerIntegration = (definition: IntegrationDefinition) => {
  if (!INTEGRATIONS.some((item) => item.id === definition.id)) INTEGRATIONS.push(definition);
};

export const findIntegration = (id: string | undefined): IntegrationDefinition | undefined =>
  INTEGRATIONS.find((item) => item.id === id);

export const isIntegrationId = (value: string | undefined): value is IntegrationId =>
  !!value && INTEGRATIONS.some((item) => item.id === value);

/** Integrations on the roadmap: shown in the directory as a hint, not openable. */
export type UpcomingIntegrationId = 'figma' | 'notion' | 'vercel' | 'zapier';

export interface UpcomingIntegration {
  icon: IntegrationDefinition['icon'];
  id: UpcomingIntegrationId;
  name: string;
}

export const UPCOMING_INTEGRATIONS: UpcomingIntegration[] = [
  { icon: Notion, id: 'notion', name: 'Notion' },
  { icon: Figma, id: 'figma', name: 'Figma' },
  { icon: Vercel, id: 'vercel', name: 'Vercel' },
  { icon: Zapier, id: 'zapier', name: 'Zapier' },
];
