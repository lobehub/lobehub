import { Flexbox } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import SettingHeader from '@/features/Settings/features/SettingHeader';

import Conversation from './features/Conversation';
import Desktop from './features/Desktop';
import Essential from './features/Essential';
import { ResetHotkeysButton } from './features/ResetHotkeysButton';

interface PageProps {
  showSettingHeader?: boolean;
}

const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');
  const resetButton = <ResetHotkeysButton />;

  return (
    <>
      {showSettingHeader ? (
        <SettingHeader extra={resetButton} title={t('tab.hotkey')} />
      ) : (
        <Flexbox horizontal justify={'flex-end'} style={{ marginBottom: 16 }}>
          {resetButton}
        </Flexbox>
      )}
      {isDesktop && <Desktop />}
      <Essential />
      <Conversation />
    </>
  );
};

export default Page;
