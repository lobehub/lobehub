/** Curated read operations reviewed against the provider's actual tool catalog.
 * https://docs.composio.dev/toolkits/gmail
 * https://docs.composio.dev/toolkits/googlecalendar
 * https://docs.composio.dev/toolkits/googledrive
 * Notion: Market's skill/providers/notion/tools.ts. Unknown/new operations stay denied.
 */
export const personalConnectorDefinitions = [
  {
    id: 'gmail',
    name: 'Gmail',
    type: 'composio',
    appSlug: 'GMAIL',
    readToolNames: [
      'GMAIL_FETCH_EMAILS',
      'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID',
      'GMAIL_FETCH_MESSAGE_BY_THREAD_ID',
      'GMAIL_GET_ATTACHMENT',
      'GMAIL_GET_PROFILE',
    ],
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    type: 'composio',
    appSlug: 'GOOGLECALENDAR',
    readToolNames: [
      'GOOGLECALENDAR_EVENTS_LIST',
      'GOOGLECALENDAR_EVENTS_GET',
      'GOOGLECALENDAR_LIST_CALENDARS',
      'GOOGLECALENDAR_GET_CALENDAR',
    ],
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    type: 'composio',
    appSlug: 'GOOGLEDRIVE',
    readToolNames: [
      'GOOGLEDRIVE_FIND_FILE',
      'GOOGLEDRIVE_GET_FILE_METADATA',
      'GOOGLEDRIVE_GET_DOCUMENT',
      'GOOGLEDRIVE_GET_SPREADSHEET',
      'GOOGLEDRIVE_GET_SPREADSHEET_VALUES',
      'GOOGLEDRIVE_GET_PRESENTATION',
    ],
  },
  {
    id: 'notion',
    name: 'Notion',
    type: 'lobehub',
    appSlug: '',
    readToolNames: [
      'notion-search',
      'notion-fetch',
      'notion-query-data-sources',
      'notion-query-database-view',
      'notion-get-comments',
      'notion-get-users',
      'notion-get-teams',
    ],
  },
] as const;
