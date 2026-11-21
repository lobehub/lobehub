import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBoard } from '../BoardContext';
import { refreshStaleArtboard } from '../data/revisionWatch';
import { useArtboardStore } from '../store';

const styles = stylex.create({
  bar: {
    backgroundColor: cssVar.colorInfoBg,
    borderBlockEndColor: cssVar.colorInfoBorder,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    flex: 'none',
    paddingBlock: 4,
    paddingInline: 12,
  },
});

const StaleBanner = () => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const stale = useArtboardStore((s) => s.staleRevision);
  const [loading, setLoading] = useState(false);
  if (stale === null) return null;

  const refresh = async () => {
    setLoading(true);
    try {
      await refreshStaleArtboard(board.artboard.id);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox
      horizontal
      align="center"
      gap={8}
      justify="space-between"
      {...stylex.props(styles.bar)}
    >
      <Text style={{ fontSize: 13 }}>{t('artboard.stale.title')}</Text>
      <Button
        icon={<Icon icon={RefreshCwIcon} />}
        loading={loading}
        size={'small'}
        type={'link'}
        onClick={refresh}
      >
        {t('artboard.stale.refresh')}
      </Button>
    </Flexbox>
  );
};

export default StaleBanner;
