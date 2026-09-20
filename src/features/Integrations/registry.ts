import type { ComponentType } from 'react';

/** Stable id of an integration; doubles as its settings sub-route (`/settings/integrations/<id>`). */
export type IntegrationId = 'github';

export interface IntegrationDefinition {
  /** Documentation page for the integration. */
  docsUrl: string;
  /** Brand mark, rendered at the size the host passes. */
  icon: ComponentType<{ size?: number; style?: React.CSSProperties }>;
  id: IntegrationId;
  /** Lower-case words the overview search matches besides the name. */
  keywords: string[];
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

/** Search over name and keywords; an empty query matches everything. */
export const filterIntegrations = (query: string): IntegrationDefinition[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return INTEGRATIONS;
  return INTEGRATIONS.filter(
    (item) =>
      item.name.toLowerCase().includes(needle) ||
      item.keywords.some((keyword) => keyword.includes(needle)),
  );
};
