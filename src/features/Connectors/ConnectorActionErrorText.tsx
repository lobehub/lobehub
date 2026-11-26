'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import InlineErrorText from '@/components/InlineErrorText';
import { type ConnectorActionError } from '@/utils/connectorActionError';

import { formatConnectorActionError } from './formatConnectorActionError';

interface ConnectorActionErrorTextProps {
  error: ConnectorActionError;
  /** Display name of the connector, used by reasons that name the app. */
  name: string;
}

/** A failed connect / remove of a whole connector, worded for the settings list. */
const ConnectorActionErrorText = memo<ConnectorActionErrorTextProps>(({ error, name }) => {
  const { t } = useTranslation('setting');

  return <InlineErrorText>{formatConnectorActionError(t, error, name)}</InlineErrorText>;
});

ConnectorActionErrorText.displayName = 'ConnectorActionErrorText';

export default ConnectorActionErrorText;
