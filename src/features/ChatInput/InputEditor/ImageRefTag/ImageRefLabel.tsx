import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ImageIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  label: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    height: '20px',
    marginInline: '1px',
    paddingInline: '6px',
    borderRadius: cssVar.borderRadiusSM,
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
    verticalAlign: 'text-bottom',
    backgroundColor: cssVar.colorFillTertiary,
  },
});

/** A sent message's `[Image #N]` reference; the image itself is shown below the text. */
export const ImageRefLabel = memo<{ number: number }>(({ number }) => {
  const { t } = useTranslation('chat');

  return (
    <span {...stylex.props(styles.label)}>
      <Icon icon={ImageIcon} size={12} />
      {t('upload.image.label', { number })}
    </span>
  );
});

ImageRefLabel.displayName = 'ImageRefLabel';
