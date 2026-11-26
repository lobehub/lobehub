import { AUTOMATION_SERVERS } from './automation';
import { CODING_SERVERS } from './coding';
import { COMMUNICATION_SERVERS } from './communication';
import { DATA_SERVERS } from './data';
import { DESIGN_SERVERS } from './design';
import { DOCUMENTS_SERVERS } from './documents';
import { FINANCE_SERVERS } from './finance';
import { OTHER_SERVERS } from './other';
import { PRODUCTIVITY_SERVERS } from './productivity';
import { RESEARCH_SERVERS } from './research';
import { SALES_SERVERS } from './sales';
import type { OfficialMcpServerType } from './types';

export type { OfficialMcpServerType } from './types';

/** Every official MCP server, grouped by category in display order. */
export const OFFICIAL_MCP_SERVERS: OfficialMcpServerType[] = [
  ...PRODUCTIVITY_SERVERS,
  ...COMMUNICATION_SERVERS,
  ...DOCUMENTS_SERVERS,
  ...SALES_SERVERS,
  ...CODING_SERVERS,
  ...DATA_SERVERS,
  ...RESEARCH_SERVERS,
  ...DESIGN_SERVERS,
  ...AUTOMATION_SERVERS,
  ...FINANCE_SERVERS,
  ...OTHER_SERVERS,
];

export const getOfficialMcpServerById = (identifier: string) =>
  OFFICIAL_MCP_SERVERS.find((server) => server.identifier === identifier);
