'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { TriangleAlert } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface InlineErrorProps {
  /** Raw failure, folded behind the details toggle. */
  detail?: string;
  /** Retry entry, when the read can simply be repeated. */
  onRetry?: () => void;
  /** One readable sentence: what failed, in the user's terms. */
  summary: string;
}

/**
 * A feature-level failure as one readable line — icon, sentence, retry — with
 * the raw message folded behind a toggle.
 *
 * A section inside agent settings is not a page: wrapping a failed read in a
 * full alert panel makes a recoverable hiccup look like the tab broke, and
 * dumps a transport string where a person expects a sentence.
 */
const InlineError = memo<InlineErrorProps>(({ summary, detail, onRetry }) => {
  const { t } = useTranslation('setting');
  const [open, setOpen] = useState(false);

  return (
    <Flexbox gap={4} paddingBlock={4}>
      <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
        <Icon icon={TriangleAlert} size={14} />
        <Text fontSize={13} type={'secondary'}>
          {summary}
        </Text>
        {onRetry && (
          <Button size={'small'} type={'text'} onClick={onRetry}>
            {t('identity.retry')}
          </Button>
        )}
        {detail && (
          <Button size={'small'} type={'text'} onClick={() => setOpen(!open)}>
            {open ? t('identity.hideDetail') : t('identity.showDetail')}
          </Button>
        )}
      </Flexbox>
      {open && detail && (
        <Text fontSize={12} style={{ wordBreak: 'break-all' }} type={'secondary'}>
          {detail}
        </Text>
      )}
    </Flexbox>
  );
});

InlineError.displayName = 'AgentIdentityInlineError';

export default InlineError;
