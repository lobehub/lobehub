import { ArtifactType } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon, Segmented, Text } from '@lobehub/ui';
import { ConfigProvider } from 'antd';
import { cx } from 'antd-style';
import { ArrowLeft, CodeIcon, EyeIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { ArtifactDisplayMode } from '@/store/chat/slices/portal/initialState';
import { oneLineEllipsis } from '@/styles';

const Title = () => {
  const { t } = useTranslation('portal');

  const [displayMode, artifactType, artifactTitle, isArtifactTagClosed, closeArtifact] =
    useChatStore((s) => {
      const messageId = chatPortalSelectors.artifactMessageId(s) || '';

      return [
        s.portalArtifactDisplayMode,
        chatPortalSelectors.artifactType(s),
        chatPortalSelectors.artifactTitle(s),
        chatPortalSelectors.isArtifactTagClosed(messageId)(s),
        s.closeArtifact,
      ];
    });

  // show switch only when artifact is closed and the type is not code
  const showSwitch = isArtifactTagClosed && artifactType !== ArtifactType.Code;

  return (
    <Flexbox align={'center'} flex={1} gap={12} horizontal justify={'space-between'} width={'100%'}>
      <Flexbox align={'center'} gap={4} horizontal>
        <ActionIcon icon={ArrowLeft} onClick={() => closeArtifact()} size={'small'} />
        <Text className={cx(oneLineEllipsis)} type={'secondary'}>
          {artifactTitle}
        </Text>
      </Flexbox>
      <ConfigProvider
        theme={{
          token: {
            borderRadiusSM: 16,
            borderRadiusXS: 16,
            fontSize: 12,
          },
        }}
      >
        {showSwitch && (
          <Segmented
            onChange={(value) => {
              useChatStore.setState({ portalArtifactDisplayMode: value as ArtifactDisplayMode });
            }}
            options={[
              {
                icon: <Icon icon={EyeIcon} />,
                label: t('artifacts.display.preview'),
                value: ArtifactDisplayMode.Preview,
              },
              {
                icon: <Icon icon={CodeIcon} />,
                label: t('artifacts.display.code'),
                value: ArtifactDisplayMode.Code,
              },
            ]}
            size={'small'}
            value={displayMode}
          />
        )}
      </ConfigProvider>
    </Flexbox>
  );
};

export default Title;
