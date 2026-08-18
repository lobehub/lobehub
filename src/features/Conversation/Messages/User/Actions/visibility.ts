import type { UIChatMessage } from '@lobechat/types';

import { isLocalOnlyMessage } from '@/store/chat/utils/localMessages';

export const shouldShowUserActions = (message: UIChatMessage) => !isLocalOnlyMessage(message);
