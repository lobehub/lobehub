import type { IconType } from '@icons-pack/react-simple-icons';
import { SiCaldotcom, SiGithub } from '@icons-pack/react-simple-icons';
import { Klavis } from 'klavis';

export interface KlavisServerType {
  /**
   * Author/Developer of the integration
   */
  author: string;
  /**
   * Author's website URL
   */
  authorUrl?: string;
  description: string;
  icon: string | IconType;
  /**
   * Identifier used for storage in database (e.g., 'google-calendar')
   * Format: lowercase, spaces replaced with hyphens
   */
  identifier: string;
  label: string;
  readme: string;
  /**
   * Server name used to call Klavis API (e.g., 'Google Calendar')
   */
  serverName: Klavis.McpServerName;
}

export const KLAVIS_SERVER_TYPES: KlavisServerType[] = [
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description: 'Gmail is a free email service provided by Google',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/gmail.svg',
    identifier: 'gmail',
    readme:
      'Bring the power of Gmail directly into your AI assistant. Read, compose, and send emails, search your inbox, manage labels, and organize your communications—all through natural conversation.',
    label: 'Gmail',
    serverName: Klavis.McpServerName.Gmail,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description: 'Google Calendar is a time-management and scheduling calendar service',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/googlecalendar.svg',
    identifier: 'google-calendar',
    readme:
      'Integrate Google Calendar to view, create, and manage your events seamlessly. Schedule meetings, set reminders, check availability, and coordinate your time—all through natural language commands.',
    label: 'Google Calendar',
    serverName: Klavis.McpServerName.GoogleCalendar,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description: 'Notion is a collaborative productivity and note-taking application',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/notion.svg',
    identifier: 'notion',
    readme:
      'Connect to Notion to access and manage your workspace. Create pages, search content, update databases, and organize your knowledge base—all through natural conversation with your AI assistant.',
    label: 'Notion',
    serverName: Klavis.McpServerName.Notion,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description:
      'Airtable is a cloud-based database and spreadsheet platform that combines the flexibility of a spreadsheet with the power of a database, enabling teams to organize, track, and collaborate on projects with customizable views and powerful automation features',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/airtable.svg',
    identifier: 'airtable',
    readme:
      'Integrate with Airtable to manage your databases and workflows. Query records, create entries, update data, and automate operations with customizable views and powerful tracking features.',
    label: 'Airtable',
    serverName: Klavis.McpServerName.Airtable,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description:
      'Google Sheets is a web-based spreadsheet application that allows users to create, edit, and collaborate on spreadsheets online',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/googlesheets.svg',
    identifier: 'google-sheets',
    readme:
      'Connect to Google Sheets to read, write, and analyze spreadsheet data. Perform calculations, generate reports, create charts, and manage tabular data collaboratively with AI assistance.',
    label: 'Google Sheets',
    serverName: Klavis.McpServerName.GoogleSheets,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description:
      'Google Docs is a word processor included as part of the free, web-based Google Docs Editors suite',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/googledocs.svg',
    identifier: 'google-docs',
    readme:
      'Integrate with Google Docs to create, edit, and manage documents. Write content, format text, collaborate in real-time, and access your documents through natural conversation.',
    label: 'Google Docs',
    serverName: Klavis.McpServerName.GoogleDocs,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description: 'Enhanced GitHub MCP Server',
    icon: SiGithub,
    identifier: 'github',
    readme:
      'Connect to GitHub to manage repositories, issues, pull requests, and code. Search code, review changes, create branches, and collaborate on software development projects through conversational AI.',
    label: 'GitHub',
    serverName: Klavis.McpServerName.Github,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description: 'Supabase official MCP Server',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/supabase.svg',
    identifier: 'supabase',
    readme:
      'Integrate with Supabase to manage your database and backend services. Query data, manage authentication, handle storage, and interact with your application backend through natural conversation.',
    label: 'Supabase',
    serverName: Klavis.McpServerName.Supabase,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description: 'Google Drive is a cloud storage service',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/googledrive.svg',
    identifier: 'google-drive',
    readme:
      'Connect to Google Drive to access, organize, and manage your files. Search documents, upload files, share content, and navigate your cloud storage efficiently through AI assistance.',
    label: 'Google Drive',
    serverName: Klavis.McpServerName.GoogleDrive,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description:
      'Slack is a messaging app for business that connects people to the information they need',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/slack.svg',
    identifier: 'slack',
    readme:
      'Integrate with Slack to send messages, search conversations, and manage channels. Connect with your team, automate communication workflows, and access workspace information through natural language.',
    label: 'Slack',
    serverName: Klavis.McpServerName.Slack,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description: 'Confluence is a team workspace where knowledge and collaboration meet',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/confluence.svg',
    identifier: 'confluence',
    readme:
      'Connect to Confluence to access and manage team documentation. Search pages, create content, organize spaces, and build your knowledge base through conversational AI assistance.',
    label: 'Confluence',
    serverName: Klavis.McpServerName.Confluence,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description: 'Jira is a project management and issue tracking tool developed by Atlassian',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/jira.svg',
    identifier: 'jira',
    readme:
      'Integrate with Jira to manage issues, track progress, and organize sprints. Create tickets, update statuses, query project data, and streamline your development workflow through natural conversation.',
    label: 'Jira',
    serverName: Klavis.McpServerName.Jira,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description:
      'ClickUp is a comprehensive project management and productivity platform that helps teams organize tasks, manage projects, and collaborate effectively with customizable workflows and powerful tracking features',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/clickup.svg',
    identifier: 'clickup',
    readme:
      'Connect to ClickUp to manage tasks, track projects, and organize your work. Create tasks, update statuses, manage custom workflows, and collaborate with your team through natural language commands.',
    label: 'ClickUp',
    serverName: Klavis.McpServerName.Clickup,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description:
      'Complete file management solution for Dropbox cloud storage. Upload, download, organize files and folders, manage sharing and collaboration, handle file versions, create file requests, and perform batch operations on your Dropbox files and folders',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/dropbox.svg',
    identifier: 'dropbox',
    readme:
      'Integrate with Dropbox to access and manage your files. Upload, download, share files, manage folders, handle file versions, and organize your cloud storage through conversational AI.',
    label: 'Dropbox',
    serverName: Klavis.McpServerName.Dropbox,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description: 'Figma is a collaborative interface design tool for web and mobile applications.',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/figma.svg',
    identifier: 'figma',
    readme:
      'Connect to Figma to access design files and collaborate on projects. View designs, export assets, browse components, and manage your design workflow through natural conversation.',
    label: 'Figma',
    serverName: Klavis.McpServerName.Figma,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description:
      'HubSpot is a developer and marketer of software products for inbound marketing, sales, and customer service',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/hubspot.svg',
    identifier: 'hubspot',
    readme:
      'Integrate with HubSpot to manage contacts, deals, and marketing campaigns. Access CRM data, track pipelines, automate workflows, and streamline your sales and marketing operations.',
    label: 'HubSpot',
    serverName: Klavis.McpServerName.Hubspot,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description:
      'OneDrive is a file hosting service and synchronization service operated by Microsoft',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/onedrive.svg',
    identifier: 'onedrive',
    readme:
      'Connect to OneDrive to access and manage your Microsoft cloud files. Upload, download, share files, organize folders, and collaborate on documents through AI-powered assistance.',
    label: 'OneDrive',
    serverName: Klavis.McpServerName.Onedrive,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description:
      'Outlook Mail is a web-based suite of webmail, contacts, tasks, and calendaring services from Microsoft.',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/outlook.svg',
    identifier: 'outlook-mail',
    readme:
      'Integrate with Outlook Mail to read, send, and manage your Microsoft emails. Search messages, compose emails, manage folders, and organize your inbox through natural conversation.',
    label: 'Outlook Mail',
    serverName: Klavis.McpServerName.OutlookMail,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description:
      "Salesforce is the world's leading customer relationship management (CRM) platform that helps businesses connect with customers, partners, and potential customers",
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/salesforce.svg',
    identifier: 'salesforce',
    readme:
      'Connect to Salesforce to manage customer relationships and sales data. Query records, update opportunities, track leads, and automate your CRM workflows through natural language commands.',
    label: 'Salesforce',
    serverName: Klavis.McpServerName.Salesforce,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description:
      'WhatsApp Business API integration that enables sending text messages, media, and managing conversations with customers. Perfect for customer support, marketing campaigns, and automated messaging workflows through the official WhatsApp Business platform.',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/whatsapp.svg',
    identifier: 'whatsapp',
    readme:
      'Integrate with WhatsApp Business to send messages, manage conversations, and engage with customers. Automate messaging workflows and handle communications through conversational AI.',
    label: 'WhatsApp',
    serverName: Klavis.McpServerName.Whatsapp,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description:
      'YouTube is a video-sharing platform where users can upload, share, and discover content. Access video information, transcripts, and metadata programmatically.',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/youtube.svg',
    identifier: 'youtube',
    readme:
      'Connect to YouTube to search videos, access transcripts, and retrieve video information. Analyze content, extract metadata, and discover videos through natural conversation.',
    label: 'YouTube',
    serverName: Klavis.McpServerName.Youtube,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description: 'Zendesk is a customer service software company',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/zendesk.svg',
    identifier: 'zendesk',
    readme:
      'Integrate with Zendesk to manage support tickets and customer interactions. Create, update, and track support requests, access customer data, and streamline your support operations.',
    label: 'Zendesk',
    serverName: Klavis.McpServerName.Zendesk,
  },
  {
    author: 'Klavis',
    authorUrl: 'https://klavis.io',
    description:
      'Cal.com is an open-source scheduling platform that helps you schedule meetings without the back-and-forth emails. Manage event types, bookings, availability, and integrate with calendars for seamless appointment scheduling',
    icon: SiCaldotcom,
    identifier: 'cal-com',
    readme:
      'Connect to Cal.com to manage your scheduling and appointments. View availability, book meetings, manage event types, and automate your calendar through natural conversation.',
    label: 'Cal.com',
    serverName: Klavis.McpServerName.CalCom,
  },
];

/**
 * Get server config by identifier
 */
export const getKlavisServerByServerIdentifier = (identifier: string) =>
  KLAVIS_SERVER_TYPES.find((s) => s.identifier === identifier);
