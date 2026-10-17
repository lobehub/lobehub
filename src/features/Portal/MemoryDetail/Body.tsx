'use client';

import { LayersEnum } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import ActivityDetail from '@/routes/(main)/memory/activities/features/ActivityDetail';
import ContextDetail from '@/routes/(main)/memory/contexts/features/ContextDetail';
import DetailNotFound from '@/routes/(main)/memory/features/DetailNotFound';
import IdentityDetail from '@/routes/(main)/memory/identities/features/IdentityDetail';
import PreferenceDetail from '@/routes/(main)/memory/preferences/features/PreferenceDetail';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const renderDetail = (layer: LayersEnum, id: string) => {
  switch (layer) {
    case LayersEnum.Activity: {
      return <ActivityDetail id={id} />;
    }
    case LayersEnum.Context: {
      return <ContextDetail id={id} />;
    }
    case LayersEnum.Identity: {
      return <IdentityDetail id={id} />;
    }
    case LayersEnum.Preference: {
      return <PreferenceDetail id={id} />;
    }
    default: {
      return <DetailNotFound />;
    }
  }
};

const Body = memo(() => {
  const view = useChatStore(chatPortalSelectors.memoryDetailView);

  if (!view) return null;

  return (
    <Flexbox
      flex={1}
      gap={16}
      paddingInline={16}
      style={{ overflowY: 'auto', paddingBottom: 64, paddingTop: 16 }}
    >
      {renderDetail(view.layer, view.id)}
    </Flexbox>
  );
});

Body.displayName = 'MemoryDetailBody';

export default Body;
