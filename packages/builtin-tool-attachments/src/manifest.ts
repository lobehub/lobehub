import { MAX_READ_WINDOW_LINES } from '@lobechat/prompts/textWindow';
import { type BuiltinToolManifest } from '@lobechat/types';

import { AttachmentsApiName, AttachmentsIdentifier } from './types';

/**
 * Read-only paging over the parsed text of a file the user attached (or an agent file) that was
 * sent to the model as a preview. Deliberately separate from `lobe-knowledge-base`: enabling that
 * whole tool for one oversized attachment also exposed knowledge-base search and write/delete APIs.
 */
export const AttachmentsManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Read the next window of an attached file that was shown only as a preview. Use the fileId from the <file> tag and the offset named in its notice. Returns whole lines, bounded to about 10k characters per call; when truncated="true", call again with the suggested offset.',
      name: AttachmentsApiName.readAttachment,
      parameters: {
        additionalProperties: false,
        properties: {
          fileId: {
            description: 'The id attribute of the <file> tag to read.',
            type: 'string',
          },
          limit: {
            description: `Maximum number of lines to return (1-${MAX_READ_WINDOW_LINES}). Defaults to 400.`,
            maximum: MAX_READ_WINDOW_LINES,
            minimum: 1,
            type: 'integer',
          },
          offset: {
            description: '1-based line number to start reading from. Defaults to 1.',
            minimum: 1,
            type: 'integer',
          },
        },
        required: ['fileId'],
        type: 'object',
      },
    },
  ],
  identifier: AttachmentsIdentifier,
  meta: {
    avatar: '📎',
    description: 'Page through attached files that were too long to include in full',
    title: 'Attachments',
  },
  systemRole: '',
  type: 'builtin',
};
