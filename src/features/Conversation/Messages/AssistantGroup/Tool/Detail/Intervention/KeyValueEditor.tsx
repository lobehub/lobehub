import { ActionIcon, Button, createStaticStyles, Flexbox, Icon, Input, toast } from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { LucidePlus, LucideTrash } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  form: css`
    position: relative;

    width: 100%;
    min-width: 600px;
    padding: 8px;
    border-radius: ${cssVar.borderRadiusLG};
  `,
  error: css`
    font-size: 12px;
    color: ${cssVar.colorError};
  `,
  formItem: css`
    margin-block-end: 4px;
  `,
  input: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
  `,
  row: css`
    position: relative;
  `,
  title: css`
    margin-block-end: 4px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface KeyValueItem {
  id: string;
  key?: string;
  value?: string;
}

interface KeyValueEditorProps {
  initialValue?: Record<string, any>;
  onCancel?: () => void;
  onFinish?: (value: Record<string, any>) => Promise<void>;
}

const recordToFormList = (record: Record<string, any>): KeyValueItem[] =>
  Object.entries(record)
    .map(([key, val], index) => ({
      id: `${key}-${index}`,
      key,
      value: typeof val === 'string' ? val : JSON.stringify(val),
    }))
    .filter((item) => item.key);

const formListToRecord = (list: KeyValueItem[]): Record<string, any> => {
  const record: Record<string, any> = {};
  list.forEach((item) => {
    if (item.key) {
      try {
        record[item.key] = JSON.parse(item.value || '""');
      } catch {
        record[item.key] = item.value || '';
      }
    }
  });
  return record;
};

const KeyValueEditor = memo<KeyValueEditorProps>(({ initialValue = {}, onFinish, onCancel }) => {
  const { t } = useTranslation(['tool', 'common']);
  const form = useForm<{ items: KeyValueItem[] }>({
    initialValues: { items: recordToFormList(initialValue) },
  });

  useEffect(() => {
    form.setValues({ items: recordToFormList(initialValue) });
  }, [initialValue, form]);

  const [updating, setUpdating] = useState(false);
  const handleFinish = async () => {
    setUpdating(true);
    try {
      const { errors, valid } = await form.validate();
      if (!valid) throw errors;
      const values = form.getValues();
      const record = formListToRecord(values.items || []);
      await onFinish?.(record);
    } catch (errorInfo) {
      console.error('Validation Failed:', errorInfo);
      toast.error(t('updateArgs.formValidationFailed') || 'Please check the form for errors.');
    }
    setUpdating(false);
  };

  const handleCancel = () => {
    onCancel?.();
  };

  const validateKey = (key: string | undefined, values: { items?: KeyValueItem[] }) => {
    if (!key) return;
    const keys = (values.items ?? []).map((i) => i?.key).filter(Boolean);
    if (keys.filter((k) => k === key).length > 1) return t('updateArgs.duplicateKeyError');
  };

  return (
    <Form autoComplete="off" className={styles.form} form={form} gap={0}>
      <Flexbox horizontal className={styles.title} gap={8}>
        <Flexbox flex={1}>key</Flexbox>
        <Flexbox flex={4}>value</Flexbox>
      </Flexbox>
      <Form.List name="items">
        {({ fields, add, remove }) => (
          <Flexbox width={'100%'}>
            {fields.map(({ key, name, index }) => (
              <Flexbox
                horizontal
                align="center"
                className={styles.row}
                gap={8}
                key={key}
                width={'100%'}
              >
                <Form.Field
                  bare
                  name={`${name}.key`}
                  required={t('updateArgs.keyRequired')}
                  validate={validateKey}
                  validateOn={'change'}
                  render={({ error, onBlur, onChange, value }) => (
                    <Flexbox className={styles.formItem} flex={1}>
                      <Input
                        allowClear
                        aria-invalid={error ? true : undefined}
                        className={styles.input}
                        placeholder={t('updateArgs.form.key')}
                        value={value}
                        variant={'filled'}
                        onBlur={onBlur}
                        onChange={(e) => onChange(e.target.value)}
                      />
                      {error && <div className={styles.error}>{error}</div>}
                    </Flexbox>
                  )}
                />
                <Flexbox className={styles.formItem} flex={4}>
                  <Form.Field bare name={`${name}.value`}>
                    <Input
                      allowClear
                      className={styles.input}
                      placeholder={t('updateArgs.form.value')}
                      variant={'filled'}
                    />
                  </Form.Field>
                </Flexbox>
                <ActionIcon
                  icon={LucideTrash}
                  size={'small'}
                  title={t('delete', { ns: 'common' })}
                  style={{
                    marginBottom: 6,
                  }}
                  onClick={() => remove(index)}
                />
              </Flexbox>
            ))}
            <Flexbox horizontal gap={8} justify={'space-between'} style={{ marginTop: 8 }}>
              <Button
                icon={<Icon icon={LucidePlus} />}
                size={'small'}
                type="fill"
                onClick={() => add({ id: `new-${Date.now()}`, key: '', value: '' })}
              >
                {t('updateArgs.form.add')}
              </Button>

              <Flexbox horizontal gap={8}>
                <Button size={'small'} onClick={handleCancel}>
                  {t('cancel', { ns: 'common' })}
                </Button>
                <Button loading={updating} size={'small'} type={'primary'} onClick={handleFinish}>
                  {t('save', { ns: 'common' })}
                </Button>
              </Flexbox>
            </Flexbox>
          </Flexbox>
        )}
      </Form.List>
    </Form>
  );
});

export default KeyValueEditor;
