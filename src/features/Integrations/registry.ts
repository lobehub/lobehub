import { Cloudflare, Notion, Railway, Vercel } from '@lobehub/icons';
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

/**
 * Integrations on the roadmap: shown in the directory as a hint, not
 * openable. Chosen for the same reason GitHub came first — each is a
 * platform that reports back on an agent's work (a failed deployment, a
 * build error, a comment on a document) and can wake the agent with it.
 */
export type UpcomingIntegrationId = 'cloudflare' | 'notion' | 'railway' | 'vercel';

export interface UpcomingIntegration {
  icon: IntegrationDefinition['icon'];
  id: UpcomingIntegrationId;
  name: string;
}

export const UPCOMING_INTEGRATIONS: UpcomingIntegration[] = [
  { icon: Vercel, id: 'vercel', name: 'Vercel' },
  { icon: Railway, id: 'railway', name: 'Railway' },
  { icon: Cloudflare, id: 'cloudflare', name: 'Cloudflare' },
  { icon: Notion, id: 'notion', name: 'Notion' },
];
