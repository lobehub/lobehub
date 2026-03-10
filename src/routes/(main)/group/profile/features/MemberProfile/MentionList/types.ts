import { type API } from '@lobechat/prompts';
import { type DropdownItem } from '@lobehub/ui';

export type MentionEntityType = 'collection' | 'api';

export interface MentionMetadata {
  apis?: API[];
  description?: string;
  identifier: string;
  instructions?: string;
  label?: string;
  pluginIdentifier?: string;
  pluginType?: string;
  type?: MentionEntityType;
}

type MentionMenuItem = Extract<DropdownItem, { type?: 'item' }>;

export type MentionListOption = MentionMenuItem & {
  description?: string;
  metadata?: MentionMetadata;
};
