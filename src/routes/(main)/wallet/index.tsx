'use client';

import { Flexbox } from '@lobehub/ui';

import AicoWallet from '@/features/AicoWallet';

const WalletPage = () => (
  <Flexbox padding={24} style={{ maxWidth: 960, width: '100%' }}>
    <AicoWallet />
  </Flexbox>
);

export default WalletPage;
