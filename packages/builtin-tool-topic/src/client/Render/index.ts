import type { BuiltinRender } from '@lobechat/types';

import { TopicToolApiName } from '../../types';
import OpenTopicRender from './OpenTopic';

export const TopicToolRenders: Record<string, BuiltinRender> = {
  [TopicToolApiName.openTopic]: OpenTopicRender as BuiltinRender,
};
