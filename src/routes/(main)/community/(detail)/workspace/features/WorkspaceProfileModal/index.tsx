'use client';

import { Flexbox, Text } from '@lobehub/ui';
import type { ModalInstance } from '@lobehub/ui/base-ui';
import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import type { DiscoverUserInfo } from '@/types/discover';

import { Content } from './Content';

interface OpenWorkspaceProfileModalOptions {
  onSuccess?: () => void | Promise<void>;
  user: DiscoverUserInfo;
}

export const openWorkspaceProfileModal = ({
  user,
  onSuccess,
}: OpenWorkspaceProfileModalOptions): ModalInstance => {
  const title = t(
    user.namespace ? 'user.workspaceProfile.title' : 'user.workspaceProfile.setup.title',
    {
      ns: 'discover',
    },
  );

  return createModal({
    content: <Content user={user} onSuccess={onSuccess} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { padding: 0 },
    },
    title: user.namespace ? (
      title
    ) : (
      <Flexbox gap={8}>
        <span>{title}</span>
        <Text style={{ fontSize: 14, fontWeight: 400, lineHeight: 1.5 }} type="secondary">
          {t('user.workspaceProfile.setup.description', { ns: 'discover' })}
        </Text>
      </Flexbox>
    ),
    width: 'min(92vw, 560px)',
  });
};
