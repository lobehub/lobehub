import { MessageMetadata } from '@lobechat/types';
import { ModelIcon } from '@lobehub/icons';
import { createStyles } from 'antd-style';
import { memo } from 'react';
import { Center, Flexbox } from 'react-layout-kit';

import TokenDetail from './UsageDetail';

export const useStyles = createStyles(({ token, css, cx }) => ({
  container: cx(css`
    font-size: 12px;
    color: ${token.colorTextQuaternary};
  `),
}));

interface UsageProps {
  metadata: MessageMetadata;
  model: string;
  provider: string;
}

const Usage = memo<UsageProps>(({ model, metadata, provider }) => {
  const { styles } = useStyles();

  return (
    <Flexbox
      align={'center'}
      className={styles.container}
      gap={12}
      horizontal
      justify={'space-between'}
    >
      <Center gap={4} horizontal style={{ fontSize: 12 }}>
        <ModelIcon model={model as string} type={'mono'} />
        {model}
      </Center>

      {!!metadata.totalTokens && (
        <TokenDetail meta={metadata} model={model as string} provider={provider} />
      )}
    </Flexbox>
  );
});

export default Usage;
