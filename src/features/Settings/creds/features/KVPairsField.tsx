'use client';

import { ActionIcon, Button, Flexbox, Input, InputPassword } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Plus, Trash2 } from 'lucide-react';
import { type FC, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  name: { flex: '2', minWidth: 0 },
  pair: { display: 'flex', gap: '8px', alignItems: 'flex-start' },
  // Keeps the inputs aligned whether or not a row has its remove button.
  remove: { flexShrink: 0, width: '32px', height: '32px' },
  value: { flex: '3', minWidth: 0 },
});

interface KVPairsFieldProps {
  disabled?: boolean;
  /** Shown above the rows, e.g. the write-only replacement hint. */
  hint?: ReactNode;
  type: 'kv-env' | 'kv-header';
}

/**
 * The variables of an environment credential, or the headers of a header
 * credential: one name / secret value row each, under a label that names
 * which of the two they are and how agents receive them.
 */
const KVPairsField: FC<KVPairsFieldProps> = ({ disabled, hint, type }) => {
  const { t } = useTranslation('setting');

  return (
    <Form.Field
      desc={hint ?? t(`creds.form.valuesDesc.${type}`)}
      label={type === 'kv-env' ? t('creds.form.envVars') : t('creds.form.headers')}
    >
      <Form.List name="kvPairs">
        {({ fields, add, remove }) => (
          <Flexbox gap={8}>
            {fields.map(({ key, index }) => (
              <div {...stylex.props(styles.pair)} key={key}>
                <div {...stylex.props(styles.name)}>
                  <Form.Field bare name={`kvPairs.${index}.key`}>
                    <Input
                      disabled={disabled}
                      placeholder={type === 'kv-env' ? 'OPENAI_API_KEY' : 'Authorization'}
                      style={{ fontFamily: cssVar.fontFamilyCode }}
                    />
                  </Form.Field>
                </div>
                <div {...stylex.props(styles.value)}>
                  <Form.Field bare name={`kvPairs.${index}.value`}>
                    <InputPassword
                      autoComplete="new-password"
                      disabled={disabled}
                      placeholder={t('creds.form.valuePlaceholder')}
                    />
                  </Form.Field>
                </div>
                <span {...stylex.props(styles.remove)}>
                  {fields.length > 1 && (
                    <ActionIcon
                      disabled={disabled}
                      icon={Trash2}
                      size={{ blockSize: 32, size: 16 }}
                      title={t('creds.form.removePair')}
                      onClick={() => remove(index)}
                    />
                  )}
                </span>
              </div>
            ))}
            <div>
              <Button
                disabled={disabled}
                icon={Plus}
                size={'small'}
                type={'text'}
                onClick={() => add({ key: '', value: '' })}
              >
                {type === 'kv-env' ? t('creds.form.addEnvVar') : t('creds.form.addHeader')}
              </Button>
            </div>
          </Flexbox>
        )}
      </Form.List>
    </Form.Field>
  );
};

export default KVPairsField;
