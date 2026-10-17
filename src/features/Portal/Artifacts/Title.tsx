import { ArtifactType } from '@lobechat/types';
import { cx, Flexbox, Icon, Tabs, Text } from '@lobehub/ui';
import { CodeIcon, EyeIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import ArtifactDeploymentActions from '@/business/client/features/ArtifactDeploymentActions';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { ArtifactDisplayMode } from '@/store/chat/slices/portal/initialState';
import { oneLineEllipsis } from '@/styles';

const Title = () => {
  const { t } = useTranslation('portal');

  const [
    messageId,
    artifactIdentifier,
    topicId,
    displayMode,
    artifactType,
    artifactTitle,
    isArtifactTagClosed,
  ] = useChatStore((s) => {
    const messageId = chatPortalSelectors.artifactMessageId(s) || '';
    const identifier = chatPortalSelectors.artifactIdentifier(s);

    return [
      messageId,
      identifier,
      s.activeTopicId,
      s.portalArtifactDisplayMode,
      chatPortalSelectors.artifactType(s),
      chatPortalSelectors.artifactTitle(s),
      chatPortalSelectors.isArtifactTagClosed(messageId, identifier)(s),
    ];
  });

  // show switch only when artifact is closed and the type is not code
  const showSwitch = isArtifactTagClosed && artifactType !== ArtifactType.Code;

  return (
    <Flexbox horizontal align={'center'} flex={1} gap={12} justify={'space-between'} width={'100%'}>
      {/* Back and close live in the shared portal header — no second arrow here. */}
      <Text className={cx(oneLineEllipsis)} type={'secondary'}>
        {artifactTitle}
      </Text>
      <Flexbox horizontal align={'center'} gap={4}>
        <ArtifactDeploymentActions
          artifactIdentifier={artifactIdentifier}
          artifactTitle={artifactTitle}
          artifactType={artifactType}
          displayMode={displayMode}
          isArtifactTagClosed={isArtifactTagClosed}
          messageId={messageId}
          topicId={topicId}
        />
        {showSwitch && (
          <Tabs
            activeKey={displayMode}
            size={'small'}
            items={[
              {
                icon: <Icon icon={EyeIcon} />,
                key: ArtifactDisplayMode.Preview,
                label: t('artifacts.display.preview'),
              },
              {
                icon: <Icon icon={CodeIcon} />,
                key: ArtifactDisplayMode.Code,
                label: t('artifacts.display.code'),
              },
            ]}
            onChange={(key) => {
              useChatStore.setState({ portalArtifactDisplayMode: key as ArtifactDisplayMode });
            }}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default Title;
