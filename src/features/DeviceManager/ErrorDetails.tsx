import { Button, Popover, Text } from '@lobehub/ui';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * A device's raw error, folded behind "Show details" so the surface leads with
 * a readable sentence and the technical message stays one click away.
 */
const ErrorDetails = ({ details, style }: { details: string; style?: CSSProperties }) => {
  const { t } = useTranslation('setting');

  return (
    <Popover
      placement={'bottomLeft'}
      styles={{ content: { maxWidth: 'min(400px, 80vw)' } }}
      trigger={'click'}
      content={
        <Text
          fontSize={12}
          style={{
            maxHeight: 200,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {details}
        </Text>
      }
    >
      <Button size={'small'} style={{ alignSelf: 'flex-start', ...style }} type={'text'}>
        {t('devices.cliUpdate.showDetails')}
      </Button>
    </Popover>
  );
};

export default ErrorDetails;
