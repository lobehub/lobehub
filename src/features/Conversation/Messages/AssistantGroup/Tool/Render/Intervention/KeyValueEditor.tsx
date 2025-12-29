import { ActionIcon, Button, Flexbox, Icon, Input } from '@lobehub/ui';
import { App, Form, type FormInstance } from 'antd';
import { createStaticStyles } from 'antd-style';
import { LucidePlus, LucideTrash } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  form: css`
    position: relative;

    width: 100%;
    min-width: 600px;
    padding: 8px;
    border-radius: ${cssVar.borderRadiusLG};
  `,
  formItem: css`
    margin-block-end: 4px !important;
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
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const formRef = useRef<FormInstance>(null);

  useEffect(() => {
    form.setFieldsValue({ items: recordToFormList(initialValue) });
  }, [initialValue, form]);

  const [updating, setUpdating] = useState(false);
  const handleFinish = async () => {
    setUpdating(true);
    try {
      await form.validateFields();
      const values = form.getFieldsValue();
      const record = formListToRecord(values.items || []);
      await onFinish?.(record);
    } catch (errorInfo) {
      console.error('Validation Failed:', errorInfo);
      message.error(t('updateArgs.formValidationFailed') || 'Please check the form for errors.');
    }
    setUpdating(false);
  };

  const handleCancel = () => {
    onCancel?.();
  };

  const validateKeys = (_: any, item: KeyValueItem, items: KeyValueItem[]) => {
    if (!item?.key) {
      return Promise.resolve();
    }
    const keys = items.map((i) => i?.key).filter(Boolean);
    if (keys.filter((k) => k === item.key).length > 1) {
      return Promise.reject(new Error(t('updateArgs.duplicateKeyError')));
    }

    return Promise.resolve();
  };

  return (
    <Form
      autoComplete="off"
      className={styles.form}
      form={form}
      initialValues={{ items: recordToFormList(initialValue) }}
      ref={formRef}
    >
      <Flexbox className={styles.title} gap={8} horizontal>
        <Flexbox flex={1}>key</Flexbox>
        <Flexbox flex={4}>value</Flexbox>
      </Flexbox>
      <Form.List name="items">
        {(fields, { add, remove }) => (
          <Flexbox width={'100%'}>
            {fields.map(({ key, name, ...restField }, index) => (
              <Flexbox
                align="center"
                className={styles.row}
                gap={8}
                horizontal
                key={key}
                width={'100%'}
              >
                <Form.Item
                  {...restField}
                  className={styles.formItem}
                  name={[name, 'key']}
                  rules={[
                    { message: t('updateArgs.keyRequired'), required: true },
                    {
                      validator: (rule) =>
                        validateKeys(
                          rule,
                          form.getFieldValue(['items', index]),
                          form.getFieldValue('items'),
                        ),
                    },
                  ]}
                  style={{ flex: 1 }}
                  validateTrigger={['onChange', 'onBlur']}
                >
                  <Input
                    allowClear
                    className={styles.input}
                    placeholder={t('updateArgs.form.key')}
                    variant={'filled'}
                  />
                </Form.Item>
                <Form.Item
                  {...restField}
                  className={styles.formItem}
                  name={[name, 'value']}
                  style={{ flex: 4 }}
                >
                  <Input
                    allowClear
                    className={styles.input}
                    placeholder={t('updateArgs.form.value')}
                    variant={'filled'}
                  />
                </Form.Item>
                <ActionIcon
                  icon={LucideTrash}
                  onClick={() => remove(name)}
                  size={'small'}
                  style={{
                    marginBottom: 6,
                  }}
                  title={t('delete', { ns: 'common' })}
                />
              </Flexbox>
            ))}
            <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
              <Flexbox gap={8} horizontal justify={'space-between'}>
                <Button
                  color={'default'}
                  icon={<Icon icon={LucidePlus} />}
                  onClick={() => add({ id: `new-${Date.now()}`, key: '', value: '' })}
                  size={'small'}
                  variant="filled"
                >
                  {t('updateArgs.form.add')}
                </Button>

                <Flexbox gap={8} horizontal>
                  <Button onClick={handleCancel} size={'small'}>
                    {t('cancel', { ns: 'common' })}
                  </Button>
                  <Button loading={updating} onClick={handleFinish} size={'small'} type={'primary'}>
                    {t('save', { ns: 'common' })}
                  </Button>
                </Flexbox>
              </Flexbox>
            </Form.Item>
          </Flexbox>
        )}
      </Form.List>
    </Form>
  );
});

export default KeyValueEditor;
