import { Flexbox, Segmented } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { floatStyles } from '../Canvas/Overlays';
import { artboardActions, useArtboardStore } from '../store';
import type { VerifyView } from '../types';
import { useJourneyView } from '../Verify/useJourneyView';

const styles = stylex.create({
  center: {
    insetBlockStart: 12,
    insetInline: 12,
    marginInline: 'auto',
    width: 'fit-content',
  },
});

export const VerifyBar = () => {
  const { t } = useTranslation('project');
  const filled = !!useJourneyView()?.run;
  const { showReal, verifyView } = useArtboardStore((s) => ({
    showReal: s.showReal,
    verifyView: s.verifyView,
  }));

  return (
    <Flexbox
      horizontal
      align="center"
      gap={8}
      justify="center"
      paddingInline={8}
      wrap="wrap"
      {...stylex.props(floatStyles.float, styles.center)}
    >
      <Segmented
        size={'small'}
        value={verifyView}
        options={[
          { label: t('artboard.verifyBar.flow'), value: 'flow' },
          { label: t('artboard.verifyBar.board'), value: 'board' },
        ]}
        onChange={(value) => artboardActions.setVerifyView(value as VerifyView)}
      />
      {filled && verifyView === 'board' && (
        <Segmented
          size={'small'}
          value={showReal ? 'real' : 'reference'}
          options={[
            { label: t('artboard.verifyBar.reference'), value: 'reference' },
            { label: t('artboard.verifyBar.real'), value: 'real' },
          ]}
          onChange={(value) => artboardActions.setShowReal(value === 'real')}
        />
      )}
    </Flexbox>
  );
};
