import { Flexbox } from '@lobehub/ui';
import { Alert, Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { LegacyRenderUIParams } from '../../types';
import { useInteractiveUIFollowUp } from '../hooks/useInteractiveUIFollowUp';
import { useSandboxFrame } from '../hooks/useSandboxFrame';
import { FollowUpReview } from './FollowUpReview';

const styles = createStaticStyles(({ css, cssVar }) => ({
  frame: css`
    width: 100%;
    height: 400px;
    border: 0;
    border-radius: 8px;
    background: ${cssVar.colorBgContainer};
    color-scheme: light dark;
  `,
  shell: css`
    overflow: hidden;
    width: 100%;
    min-width: 0;
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
  `,
  note: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

export const SandboxPreview = ({
  source,
  title,
}: {
  source: { html: string; css: string; js: string };
  title: string;
}) => {
  const { document, frameRef } = useSandboxFrame(source, 'preview');
  return document ? (
    <iframe
      className={styles.frame}
      ref={frameRef}
      referrerPolicy="no-referrer"
      sandbox=""
      srcDoc={document}
      title={title}
    />
  ) : null;
};

const RunningWidget = ({
  source,
  messageId,
  readOnly,
}: {
  source: LegacyRenderUIParams;
  messageId: string;
  readOnly: boolean;
}) => {
  const { t } = useTranslation('plugin');
  const { document, error, frameRef, paused, proposal, setProposal } = useSandboxFrame(
    source,
    'complete',
  );
  const followUp = useInteractiveUIFollowUp(messageId, source.title, readOnly);
  return (
    <Flexbox gap={12}>
      {paused && <Alert title={t('builtins.lobe-interactive-ui.paused')} type="warning" />}
      {error ? (
        <Alert
          description={source.fallback}
          title={t('builtins.lobe-interactive-ui.invalid')}
          type="warning"
        />
      ) : (
        <iframe
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'"
          className={styles.frame}
          ref={frameRef}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts"
          srcDoc={document}
          title={source.title}
        />
      )}
      {proposal && (
        <FollowUpReview
          followUp={followUp}
          proposal={proposal}
          onChange={setProposal}
          onDismiss={() => setProposal(undefined)}
        />
      )}
    </Flexbox>
  );
};

export const InteractiveWidget = ({
  source,
  messageId,
  readOnly,
}: {
  source: LegacyRenderUIParams;
  messageId: string;
  readOnly: boolean;
}) => {
  const { t } = useTranslation('plugin');
  const [open, setOpen] = useState(true);
  const [revision, setRevision] = useState(0);
  return (
    <Flexbox className={styles.shell} gap={12}>
      <Flexbox horizontal align="center" gap={8} justify="space-between" wrap="wrap">
        <strong>{source.title}</strong>
        <Flexbox horizontal gap={8}>
          {open && (
            <Button size="small" onClick={() => setRevision((value) => value + 1)}>
              {t('builtins.lobe-interactive-ui.restart')}
            </Button>
          )}
          <Button size="small" onClick={() => setOpen((value) => !value)}>
            {t(open ? 'builtins.lobe-interactive-ui.close' : 'builtins.lobe-interactive-ui.reopen')}
          </Button>
        </Flexbox>
      </Flexbox>
      <span className={styles.note}>{t('builtins.lobe-interactive-ui.localState')}</span>
      {open ? (
        <RunningWidget key={revision} messageId={messageId} readOnly={readOnly} source={source} />
      ) : (
        <span>{source.fallback}</span>
      )}
      <details>
        <summary>{t('builtins.lobe-interactive-ui.fallback')}</summary>
        <p>{source.fallback}</p>
      </details>
    </Flexbox>
  );
};
