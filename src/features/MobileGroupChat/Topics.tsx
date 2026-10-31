import { Flexbox, Modal } from '@lobehub/ui';
import { MessageSquarePlusIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import { OverlayContainerContext } from '@/features/NavPanel/OverlayContainer';
import Actions from '@/routes/(main)/group/_layout/Sidebar/Topic/Actions';
import TopicList from '@/routes/(main)/group/_layout/Sidebar/Topic/List';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const MobileGroupTopics = () => {
  const { t } = useTranslation('topic');
  const [showTopics, toggleMobileTopic] = useGlobalStore((s) => [
    systemStatusSelectors.mobileShowTopic(s),
    s.toggleMobileTopic,
  ]);
  const switchToNewTopic = useAgentGroupStore((s) => s.switchToNewTopic);
  const [overlayContainer, setOverlayContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => () => toggleMobileTopic(false), [toggleMobileTopic]);

  return (
    <OverlayContainerContext value={overlayContainer}>
      {/* Keep topic navigation in the route tree, like the mobile conversation portal. */}
      <Modal
        allowFullscreen
        footer={null}
        open={showTopics}
        styles={{ body: { padding: 0 } }}
        title={t('title')}
        onCancel={() => toggleMobileTopic(false)}
      >
        <div ref={setOverlayContainer}>
          <Flexbox gap={8} padding={8} style={{ maxHeight: '70dvh', overflowY: 'auto' }}>
            <Flexbox horizontal align={'center'} justify={'space-between'}>
              <NavItem
                icon={MessageSquarePlusIcon}
                title={t('actions.addNewTopic')}
                onClick={() => {
                  switchToNewTopic();
                  toggleMobileTopic(false);
                }}
              />
              <Actions />
            </Flexbox>
            <TopicList showEmptyAction={false} />
          </Flexbox>
        </div>
      </Modal>
    </OverlayContainerContext>
  );
};
