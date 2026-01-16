export type MarketPublishAction = 'submit' | 'upload';

export interface OriginalGroupInfo {
  author?: {
    avatar?: string;
    name?: string;
    userName?: string;
  };
  avatar?: string;
  identifier: string;
  name: string;
}
