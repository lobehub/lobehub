// Fixture: a settings section that only renders an imported field component; this file renders no input of its own.
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import InlineField from './InlineField';
import PanelSection from './PanelSection';

interface Environment {
  description?: string;
  name: string;
}

interface EnvironmentFormProps {
  environment: Environment;
  onSave: (patch: Partial<Environment>) => Promise<void>;
}

const EnvironmentForm = memo<EnvironmentFormProps>(({ environment, onSave }) => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox>
      <PanelSection desc={t('environments.form.desc')} title={t('environments.form.basics')}>
        <InlineField
          required
          label={t('environments.nameLabel')}
          placeholder={t('environments.namePlaceholder')}
          value={environment.name}
          onSave={(name) => onSave({ name })}
        />
        <InlineField
          label={t('environments.form.description')}
          placeholder={t('environments.form.descriptionPlaceholder')}
          value={environment.description ?? ''}
          onSave={(description) => onSave({ description })}
        />
      </PanelSection>
    </Flexbox>
  );
});

export default EnvironmentForm;
