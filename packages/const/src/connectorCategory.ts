import { getOfficialMcpServerById } from './officialMcp';

/**
 * App categories shared by every connector catalog (LobeHub, Composio and
 * official MCP servers), in display order. Modeled on OpenBot's taxonomy, with
 * its oversized "productivity" split into productivity / communication / sales
 * and its "other" (mostly money apps) named finance.
 */
export const CONNECTOR_CATEGORIES = [
  'productivity',
  'communication',
  'documents',
  'sales',
  'coding',
  'data',
  'research',
  'design',
  'automation',
  'finance',
  'other',
] as const;

export type ConnectorCategory = (typeof CONNECTOR_CATEGORIES)[number];

/** Categories of the LobeHub and Composio entries; official MCP servers carry their own. */
const CATEGORY_BY_ID: Record<string, ConnectorCategory> = {
  'airtable': 'documents',
  'cal-com': 'productivity',
  'clickup': 'productivity',
  'confluence': 'documents',
  'dropbox': 'documents',
  'figma': 'design',
  'github': 'coding',
  'gmail': 'productivity',
  'google-calendar': 'productivity',
  'google-docs': 'documents',
  'google-drive': 'documents',
  'google-sheets': 'documents',
  'hubspot': 'sales',
  'jira': 'productivity',
  'linear': 'productivity',
  'microsoft': 'productivity',
  'notion': 'documents',
  'onedrive': 'documents',
  'outlook-mail': 'productivity',
  'posthog': 'data',
  'salesforce': 'sales',
  'slack': 'communication',
  'supabase': 'coding',
  'twitter': 'communication',
  'vercel': 'coding',
  'whatsapp': 'communication',
  'youtube': 'communication',
  'zendesk': 'sales',
};

/** The category an app identifier lists under; unknown identifiers fall back to `other`. */
export const getConnectorCategory = (identifier: string): ConnectorCategory =>
  CATEGORY_BY_ID[identifier] ?? getOfficialMcpServerById(identifier)?.category ?? 'other';
