import type { PortalImpl } from '../type';
import Body from './Body';
import ThreadBody from './ThreadBody';
import { TopicCommentsTitle, TopicCommentThreadTitle } from './Title';

export const TopicComments: PortalImpl = {
  Body,
  Title: TopicCommentsTitle,
};

export const TopicCommentThread: PortalImpl = {
  Body: ThreadBody,
  Title: TopicCommentThreadTitle,
};
