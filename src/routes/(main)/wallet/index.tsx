'use client';

import { useAicoPanelContainerProps } from '@/features/AicoPanels';
import AicoWallet from '@/features/AicoWallet';
import SettingContainer from '@/features/Setting/SettingContainer';

const WalletPage = () => {
  const containerProps = useAicoPanelContainerProps(960);

  return (
    <SettingContainer {...containerProps}>
      <AicoWallet />
    </SettingContainer>
  );
};

export default WalletPage;
