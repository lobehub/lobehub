import { Center, Tag, Text } from '@lobehub/ui';
import { BrandLoading, LobeHubText } from '@lobehub/ui/brand';

import { isCustomBranding } from '@/const/version';

import CircleLoading from '../CircleLoading';

interface BrandTextLoadingProps {
  debugId: string;
}

const BrandTextLoading = ({ debugId }: BrandTextLoadingProps) => {
  if (isCustomBranding) return <CircleLoading />;

  return (
    <Center height={'100%'} width={'100%'}>
      <BrandLoading size={40} style={{ opacity: 0.6 }} text={LobeHubText} />
      {process.env.NODE_ENV === 'development' && debugId && (
        <Center gap={4} padding={16}>
          <Text code style={{ alignItems: 'center', display: 'flex' }}>
            Debug ID:{' '}
            <Tag size={'large'}>
              <Text code>{debugId}</Text>
            </Tag>
          </Text>
          <Text fontSize={12} type={'secondary'}>
            only visible in development
          </Text>
        </Center>
      )}
    </Center>
  );
};

export default BrandTextLoading;
