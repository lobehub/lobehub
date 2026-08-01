'use client';

import AicoWallet from '@/features/AicoWallet';
import SettingContainer from '@/features/Setting/SettingContainer';

const WalletPage = () => (
  <SettingContainer
    flex={1}
    maxWidth={960}
    paddingBlock={'24px 48px'}
    paddingInline={24}
    style={{ minHeight: 0 }}
  >
    <AicoWallet />
  </SettingContainer>
);

export default WalletPage;
