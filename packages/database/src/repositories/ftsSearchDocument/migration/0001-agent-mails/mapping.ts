import { analysis } from '../0000-initial-search-indexes/analysis';
import {
  date,
  icuText,
  keyword,
  mixedText,
  projectionMetadataProperties,
  timestampProperties,
} from '../0000-initial-search-indexes/fields';
import type { FtsSearchMappingMigration } from '../types';

/** Agent mail, candidate-only: the mail model hydrates and authorizes the ids it returns. */
export const agentMailsSearchIndex = {
  id: '0001-agent-mails',
  analysis,
  definitions: {
    agentMails: {
      mappings: {
        dynamic: 'strict',
        properties: {
          ...projectionMetadataProperties,
          ...timestampProperties,
          account_id: keyword,
          agent_id: keyword,
          delivered_at: date,
          direction: keyword,
          from_address: icuText,
          from_name: mixedText,
          id: keyword,
          recipients: icuText,
          subject: mixedText,
          text: mixedText,
          thread_key: keyword,
          user_id: keyword,
          workspace_id: keyword,
        },
      },
      schemaVersion: 1,
    },
  },
} as const satisfies FtsSearchMappingMigration;
