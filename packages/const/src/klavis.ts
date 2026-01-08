import { IconType, SiCaldotcom, SiGithub } from '@icons-pack/react-simple-icons';
import { Klavis } from 'klavis';

export interface KlavisServerType {
  icon: string | IconType;
  /**
   * Identifier used for storage in database (e.g., 'google-calendar')
   * Format: lowercase, spaces replaced with hyphens
   */
  identifier: string;
  label: string;
  /**
   * Server name used to call Klavis API (e.g., 'Google Calendar')
   */
  serverName: Klavis.McpServerName;
}

export const KLAVIS_SERVER_TYPES: KlavisServerType[] = [
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/gmail.svg',
    identifier: 'gmail',
    label: 'Gmail',
    serverName: Klavis.McpServerName.Gmail,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/googlecalendar.svg',
    identifier: 'google-calendar',
    label: 'Google Calendar',
    serverName: Klavis.McpServerName.GoogleCalendar,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/notion.svg',
    identifier: 'notion',
    label: 'Notion',
    serverName: Klavis.McpServerName.Notion,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/airtable.svg',
    identifier: 'airtable',
    label: 'Airtable',
    serverName: Klavis.McpServerName.Airtable,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/googlesheets.svg',
    identifier: 'google-sheets',
    label: 'Google Sheets',
    serverName: Klavis.McpServerName.GoogleSheets,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/googledocs.svg',
    identifier: 'google-docs',
    label: 'Google Docs',
    serverName: Klavis.McpServerName.GoogleDocs,
  },
  {
    icon: SiGithub,
    identifier: 'github',
    label: 'GitHub',
    serverName: Klavis.McpServerName.Github,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/supabase.svg',
    identifier: 'supabase',
    label: 'Supabase',
    serverName: Klavis.McpServerName.Supabase,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/googledrive.svg',
    identifier: 'google-drive',
    label: 'Google Drive',
    serverName: Klavis.McpServerName.GoogleDrive,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/slack.svg',
    identifier: 'slack',
    label: 'Slack',
    serverName: Klavis.McpServerName.Slack,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/confluence.svg',
    identifier: 'confluence',
    label: 'Confluence',
    serverName: Klavis.McpServerName.Confluence,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/jira.svg',
    identifier: 'jira',
    label: 'Jira',
    serverName: Klavis.McpServerName.Jira,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/clickup.svg',
    identifier: 'clickup',
    label: 'ClickUp',
    serverName: Klavis.McpServerName.Clickup,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/dropbox.svg',
    identifier: 'dropbox',
    label: 'Dropbox',
    serverName: Klavis.McpServerName.Dropbox,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/figma.svg',
    identifier: 'figma',
    label: 'Figma',
    serverName: Klavis.McpServerName.Figma,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/hubspot.svg',
    identifier: 'hubspot',
    label: 'HubSpot',
    serverName: Klavis.McpServerName.Hubspot,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/onedrive.svg',
    identifier: 'onedrive',
    label: 'OneDrive',
    serverName: Klavis.McpServerName.Onedrive,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/outlook.svg',
    identifier: 'outlook-mail',
    label: 'Outlook Mail',
    serverName: Klavis.McpServerName.OutlookMail,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/salesforce.svg',
    identifier: 'salesforce',
    label: 'Salesforce',
    serverName: Klavis.McpServerName.Salesforce,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/whatsapp.svg',
    identifier: 'whatsapp',
    label: 'WhatsApp',
    serverName: Klavis.McpServerName.Whatsapp,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/youtube.svg',
    identifier: 'youtube',
    label: 'YouTube',
    serverName: Klavis.McpServerName.Youtube,
  },
  {
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/zendesk.svg',
    identifier: 'zendesk',
    label: 'Zendesk',
    serverName: Klavis.McpServerName.Zendesk,
  },
  {
    icon: SiCaldotcom,
    identifier: 'cal-com',
    label: 'Cal.com',
    serverName: Klavis.McpServerName.CalCom,
  },
];
