import { TypeIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputStore } from '../../store';
import { ChatInputAction } from '../components/ChatInputAction';

const Typo = memo(() => {
  const { t } = useTranslation('editor');
  const [showTypoBar, setShowTypoBar] = useChatInputStore((s) => [s.showTypoBar, s.setShowTypoBar]);

  return (
    <ChatInputAction
      active={showTypoBar}
      icon={TypeIcon}
      title={t(showTypoBar ? 'actions.typobar.off' : 'actions.typobar.on')}
      onClick={() => setShowTypoBar(!showTypoBar)}
    />
  );
});

export default Typo;
