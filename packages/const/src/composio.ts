import type { IconType } from '@icons-pack/react-simple-icons';
import { SiCaldotcom } from '@icons-pack/react-simple-icons';

export interface ComposioAppType {
  appSlug: string;
  author: string;
  authorUrl?: string;
  description: string;
  icon: string | IconType;
  identifier: string;
  label: string;
  readme: string;
}

export const COMPOSIO_APP_TYPES: ComposioAppType[] = [
  {
    appSlug: 'GMAIL',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description: 'Gmail is a free email service provided by Google',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/gmail.svg',
    identifier: 'gmail',
    label: 'Gmail',
    readme:
      'Bring the power of Gmail directly into your AI assistant. Read, compose, and send emails, search your inbox, manage labels, and organize your communications—all through natural conversation.',
  },
  {
    appSlug: 'GOOGLECALENDAR',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description: 'Google Calendar is a time-management and scheduling calendar service',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/googlecalendar.svg',
    identifier: 'google-calendar',
    label: 'Google Calendar',
    readme:
      'Integrate Google Calendar to view, create, and manage your events seamlessly. Schedule meetings, set reminders, check availability, and coordinate your time—all through natural language commands.',
  },
  {
    appSlug: 'AIRTABLE',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description:
      'Airtable is a cloud-based database and spreadsheet platform that combines the flexibility of a spreadsheet with the power of a database, enabling teams to organize, track, and collaborate on projects with customizable views and powerful automation features',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/airtable.svg',
    identifier: 'airtable',
    label: 'Airtable',
    readme:
      'Integrate with Airtable to manage your databases and workflows. Query records, create entries, update data, and automate operations with customizable views and powerful tracking features.',
  },
  {
    appSlug: 'GOOGLESHEETS',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description:
      'Google Sheets is a web-based spreadsheet application that allows users to create, edit, and collaborate on spreadsheets online',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/googlesheets.svg',
    identifier: 'google-sheets',
    label: 'Google Sheets',
    readme:
      'Connect to Google Sheets to read, write, and analyze spreadsheet data. Perform calculations, generate reports, create charts, and manage tabular data collaboratively with AI assistance.',
  },
  {
    appSlug: 'GOOGLEDOCS',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description:
      'Google Docs is a word processor included as part of the free, web-based Google Docs Editors suite',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/googledocs.svg',
    identifier: 'google-docs',
    label: 'Google Docs',
    readme:
      'Integrate with Google Docs to create, edit, and manage documents. Write content, format text, collaborate in real-time, and access your documents through natural conversation.',
  },
  {
    appSlug: 'SUPABASE',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description: 'Supabase open source Firebase alternative with PostgreSQL',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/supabase.svg',
    identifier: 'supabase',
    label: 'Supabase',
    readme:
      'Integrate with Supabase to manage your database and backend services. Query data, manage authentication, handle storage, and interact with your application backend through natural conversation.',
  },
  {
    appSlug: 'GOOGLEDRIVE',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description: 'Google Drive is a cloud storage service',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/googledrive.svg',
    identifier: 'google-drive',
    label: 'Google Drive',
    readme:
      'Connect to Google Drive to access, organize, and manage your files. Search documents, upload files, share content, and navigate your cloud storage efficiently through AI assistance.',
  },
  {
    appSlug: 'SLACK',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description:
      'Slack is a messaging app for business that connects people to the information they need',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/slack.svg',
    identifier: 'slack',
    label: 'Slack',
    readme:
      'Integrate with Slack to send messages, search conversations, and manage channels. Connect with your team, automate communication workflows, and access workspace information through natural language.',
  },
  {
    appSlug: 'CONFLUENCE',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description: 'Confluence is a team workspace where knowledge and collaboration meet',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/confluence.svg',
    identifier: 'confluence',
    label: 'Confluence',
    readme:
      'Connect to Confluence to access and manage team documentation. Search pages, create content, organize spaces, and build your knowledge base through conversational AI assistance.',
  },
  {
    appSlug: 'JIRA',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description: 'Jira is a project management and issue tracking tool developed by Atlassian',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/jira.svg',
    identifier: 'jira',
    label: 'Jira',
    readme:
      'Integrate with Jira to manage issues, track progress, and organize sprints. Create tickets, update statuses, query project data, and streamline your development workflow through natural conversation.',
  },
  {
    appSlug: 'CLICKUP',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description:
      'ClickUp is a comprehensive project management and productivity platform that helps teams organize tasks, manage projects, and collaborate effectively with customizable workflows and powerful tracking features',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/clickup.svg',
    identifier: 'clickup',
    label: 'ClickUp',
    readme:
      'Connect to ClickUp to manage tasks, track projects, and organize your work. Create tasks, update statuses, manage custom workflows, and collaborate with your team through natural language commands.',
  },
  {
    appSlug: 'DROPBOX',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description:
      'Complete file management solution for Dropbox cloud storage. Upload, download, organize files and folders, manage sharing and collaboration, handle file versions, create file requests, and perform batch operations on your Dropbox files and folders',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/dropbox.svg',
    identifier: 'dropbox',
    label: 'Dropbox',
    readme:
      'Integrate with Dropbox to access and manage your files. Upload, download, share files, manage folders, handle file versions, and organize your cloud storage through conversational AI.',
  },
  {
    appSlug: 'FIGMA',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description: 'Figma is a collaborative interface design tool for web and mobile applications.',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/figma.svg',
    identifier: 'figma',
    label: 'Figma',
    readme:
      'Connect to Figma to access design files and collaborate on projects. View designs, export assets, browse components, and manage your design workflow through natural conversation.',
  },
  {
    appSlug: 'HUBSPOT',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description:
      'HubSpot is a developer and marketer of software products for inbound marketing, sales, and customer service',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/hubspot.svg',
    identifier: 'hubspot',
    label: 'HubSpot',
    readme:
      'Integrate with HubSpot to manage contacts, deals, and marketing campaigns. Access CRM data, track pipelines, automate workflows, and streamline your sales and marketing operations.',
  },
  {
    appSlug: 'ONE_DRIVE',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description:
      'OneDrive is a file hosting service and synchronization service operated by Microsoft',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/onedrive.svg',
    identifier: 'onedrive',
    label: 'OneDrive',
    readme:
      'Connect to OneDrive to access and manage your Microsoft cloud files. Upload, download, share files, organize folders, and collaborate on documents through AI-powered assistance.',
  },
  {
    appSlug: 'OUTLOOK',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description:
      'Outlook Mail is a web-based suite of webmail, contacts, tasks, and calendaring services from Microsoft.',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/outlook.svg',
    identifier: 'outlook-mail',
    label: 'Outlook Mail',
    readme:
      'Integrate with Outlook Mail to read, send, and manage your Microsoft emails. Search messages, compose emails, manage folders, and organize your inbox through natural conversation.',
  },
  {
    appSlug: 'SALESFORCE',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description:
      "Salesforce is the world's leading customer relationship management (CRM) platform that helps businesses connect with customers, partners, and potential customers",
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/salesforce.svg',
    identifier: 'salesforce',
    label: 'Salesforce',
    readme:
      'Connect to Salesforce to manage customer relationships and sales data. Query records, update opportunities, track leads, and automate your CRM workflows through natural language commands.',
  },
  {
    appSlug: 'WHATSAPP',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description:
      'WhatsApp Business API integration that enables sending text messages, media, and managing conversations with customers.',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/whatsapp.svg',
    identifier: 'whatsapp',
    label: 'WhatsApp',
    readme:
      'Integrate with WhatsApp Business to send messages, manage conversations, and engage with customers. Automate messaging workflows and handle communications through conversational AI.',
  },
  {
    appSlug: 'YOUTUBE',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description:
      'YouTube is a video-sharing platform where users can upload, share, and discover content. Access video information, transcripts, and metadata programmatically.',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/youtube.svg',
    identifier: 'youtube',
    label: 'YouTube',
    readme:
      'Connect to YouTube to search videos, access transcripts, and retrieve video information. Analyze content, extract metadata, and discover videos through natural conversation.',
  },
  {
    appSlug: 'ZENDESK',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description: 'Zendesk is a customer service software company',
    icon: 'https://hub-apac-1.lobeobjects.space/assets/logos/zendesk.svg',
    identifier: 'zendesk',
    label: 'Zendesk',
    readme:
      'Integrate with Zendesk to manage support tickets and customer interactions. Create, update, and track support requests, access customer data, and streamline your support operations.',
  },
  {
    appSlug: 'CALCOM',
    author: 'Composio',
    authorUrl: 'https://composio.dev',
    description:
      'Cal.com is an open-source scheduling platform that helps you schedule meetings without the back-and-forth emails.',
    icon: SiCaldotcom,
    identifier: 'cal-com',
    label: 'Cal.com',
    readme:
      'Connect to Cal.com to manage your scheduling and appointments. View availability, book meetings, manage event types, and automate your calendar through natural conversation.',
  },
];

export const getComposioAppByIdentifier = (identifier: string) =>
  COMPOSIO_APP_TYPES.find((s) => s.identifier === identifier);
