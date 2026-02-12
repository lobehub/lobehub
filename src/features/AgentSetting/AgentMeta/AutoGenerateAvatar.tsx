import { ActionIcon, Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Wand2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

export interface AutoGenerateAvatarProps {
  background?: string;
  canAutoGenerate?: boolean;
  loading?: boolean;
  onChange?: (value: string) => void;
  onGenerate?: () => void;
  value?: string;
}

const AutoGenerateAvatar = memo<AutoGenerateAvatarProps>(
  ({ loading, background, value, onChange, onGenerate, canAutoGenerate }) => {
    const { t } = useTranslation('common');
    const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);

    return (
      <Flexbox
        horizontal
        align={'center'}
        flex={'none'}
        gap={2}
        padding={2}
        style={{
          background: cssVar.colorBgContainer,
          border: `1px solid ${cssVar.colorBorderSecondary}`,
          borderRadius: 32,
          paddingRight: 8,
          width: 'fit-content',
        }}
      >
        <EmojiPicker
          background={background || cssVar.colorFillTertiary}
          loading={loading}
          locale={locale}
          size={48}
          value={value}
          style={{
            background: cssVar.colorFillTertiary,
          }}
          onChange={onChange}
        />
        <ActionIcon
          disabled={!canAutoGenerate}
          icon={Wand2}
          loading={loading}
          size="small"
          title={!canAutoGenerate ? t('autoGenerateTooltipDisabled') : t('autoGenerate')}
          onClick={onGenerate}
        />
      </Flexbox>
    );
  },
);

export default AutoGenerateAvatar;
