import type { BuiltinToolManifest } from '@lobechat/types';
import { COLLECTION_WORK_MAX_ITEMS } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { WorkApiName, WorkIdentifier } from './types';

const workId = {
  description: 'Id of a Work you created in this conversation, as createWork returned it (workId).',
  type: 'string',
} as const;

const items = {
  description:
    'Collection images in display order. Each image is the generationId (gen_…) an image generation result lists, or a file id (file_…) or /f/file_… link.',
  items: {
    properties: {
      caption: { description: 'Short caption shown with the image.', type: 'string' },
      image: {
        description: 'generationId (gen_…), file id (file_…) or /f/file_… link of the image.',
        type: 'string',
      },
    },
    required: ['image'],
    type: 'object',
  },
  maxItems: COLLECTION_WORK_MAX_ITEMS,
  minItems: 1,
  type: 'array',
} as const;

const coverImage = {
  description: 'One of the items images to show on the card; defaults to the first image.',
  type: 'string',
} as const;

const description = { description: 'Short card description.', type: 'string' } as const;

export const WorkManifest: BuiltinToolManifest = {
  identifier: WorkIdentifier,
  type: 'builtin',
  systemRole: systemPrompt,
  meta: {
    avatar: '🗂️',
    title: 'Works',
    description:
      'Show what you produced as a Work card under your reply: a collection of images (more media types later) or a published link. Change or delete Works you created.',
  },
  api: [
    {
      name: WorkApiName.createWork,
      humanIntervention: 'never',
      description:
        'Create a Work card under your reply. type "collection" collects several images into one card; type "link" registers an http(s) page you published. Returns the workId.',
      parameters: {
        properties: {
          coverImage,
          description,
          items,
          title: { description: 'Card title.', type: 'string' },
          type: { enum: ['collection', 'link'], type: 'string' },
          url: { description: 'http(s) link; required for type "link".', type: 'string' },
        },
        required: ['type', 'title'],
        type: 'object',
      },
    },
    {
      name: WorkApiName.updateWork,
      humanIntervention: 'never',
      description:
        'Save a new version of a Work you created. items replaces the whole image list of a collection; fields left out keep their values. A link keeps its URL.',
      parameters: {
        properties: {
          coverImage,
          description,
          items,
          title: { description: 'New card title.', type: 'string' },
          workId,
        },
        required: ['workId'],
        type: 'object',
      },
    },
    {
      name: WorkApiName.deleteWork,
      humanIntervention: 'never',
      description:
        'Delete a Work you created by mistake. Removes the card and its versions; the images stay.',
      parameters: {
        properties: { workId },
        required: ['workId'],
        type: 'object',
      },
    },
  ],
};
