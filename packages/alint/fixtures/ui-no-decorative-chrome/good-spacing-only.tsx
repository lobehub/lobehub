// Fixture: structure from spacing; the only boundary is on an input.
import { Flexbox } from '@lobehub/ui';
import { Input } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const IntegrationsBody = memo<{ children: ReactNode; onSearch: (value: string) => void }>(
  ({ children, onSearch }) => {
    const { t } = useTranslation('setting');

    return (
      <Flexbox gap={16}>
        <Input
          placeholder={t('integrations.search')}
          onChange={(event) => onSearch(event.target.value)}
        />
        <Flexbox gap={8}>{children}</Flexbox>
      </Flexbox>
    );
  },
);

export default IntegrationsBody;
