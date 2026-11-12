'use client';

import { cssVar, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';

import SandboxDrive from './index';

const styles = stylex.create({
  content: {
    display: 'flex',
    justifyContent: 'center',
    width: '100%',
    paddingBlockStart: '24px',
    paddingBlockEnd: '64px',
    paddingInline: '32px',
  },
  scroll: {
    overflowX: 'hidden',
    overflowY: 'auto',
    flex: '1',
  },
});

/**
 * Docs → Sandbox Storage: the cloud sandbox's drives under the Docs sidebar,
 * beside the file drive. Settings used to host it as the “Storage” tab.
 */
const SandboxStoragePage = memo(() => {
  const { t } = useTranslation('file');

  return (
    <Flexbox height={'100%'}>
      <NavHeader
        left={<Flexbox style={{ marginLeft: 8 }}>{t('docs.section.sandboxStorage')}</Flexbox>}
        style={{ borderBottom: `1px solid ${cssVar.colorBorderSecondary}` }}
      />
      <div {...stylex.props(styles.scroll)}>
        <div {...stylex.props(styles.content)}>
          <SandboxDrive />
        </div>
      </div>
    </Flexbox>
  );
});

SandboxStoragePage.displayName = 'SandboxStoragePage';

export default SandboxStoragePage;
