'use client';

import { Alert, Flexbox, TextArea } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import type { FormInstance } from 'antd';
import {
  inferModality,
  type JsonSchemaObject,
  jsonSchemaToParameters,
} from 'model-bank/standardParameters/fromJsonSchema';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface SchemaPasteFieldProps {
  form: FormInstance;
}

interface ParseOutcome {
  detail?: string;
  message: string;
  type: 'error' | 'success' | 'warning';
}

/**
 * Read the input/output schemas out of the pasted document.
 *
 * Providers publish them differently: Replicate nests them under
 * `components.schemas.{Input,Output}` of an OpenAPI document, while a model
 * page often shows the bare input object on its own. Both are accepted, along
 * with an explicit `{ input, output }` pair.
 */
const readSchemas = (
  parsed: Record<string, any>,
): { input?: JsonSchemaObject; output?: JsonSchemaObject } => {
  const components = parsed.components?.schemas;
  if (components?.Input) return { input: components.Input, output: components.Output };

  if (parsed.input || parsed.output) return { input: parsed.input, output: parsed.output };

  // A bare input object: `{ type: 'object', properties: { … } }`.
  if (parsed.properties) return { input: parsed as JsonSchemaObject };

  return {};
};

/**
 * Developer-mode shortcut: paste a provider's API schema and have the model's
 * type and generation parameters filled in, instead of transcribing them by
 * hand from the provider's docs.
 */
const SchemaPasteField = ({ form }: SchemaPasteFieldProps) => {
  const { t } = useTranslation('modelProvider');
  const [value, setValue] = useState('');
  const [outcome, setOutcome] = useState<ParseOutcome>();

  const apply = () => {
    let parsed: Record<string, any>;

    try {
      parsed = JSON.parse(value);
    } catch {
      setOutcome({
        message: t('providerModels.item.modelConfig.schemaPaste.invalidJson'),
        type: 'error',
      });
      return;
    }

    const { input, output } = readSchemas(parsed);

    if (!input?.properties) {
      setOutcome({
        message: t('providerModels.item.modelConfig.schemaPaste.noInput'),
        type: 'error',
      });
      return;
    }

    // The user picks the type when the schema cannot settle it, so an
    // already-selected type wins over the inference.
    const selectedType = form.getFieldValue('type');
    const modality =
      selectedType === 'image' || selectedType === 'video'
        ? selectedType
        : inferModality({ input, output });

    if (!modality) {
      setOutcome({
        message: t('providerModels.item.modelConfig.schemaPaste.unknownType'),
        type: 'error',
      });
      return;
    }

    const { parameters, unmapped } =
      modality === 'video'
        ? jsonSchemaToParameters(input, 'video')
        : jsonSchemaToParameters(input, 'image');

    form.setFieldsValue({ parameters, type: modality });

    setOutcome({
      detail: unmapped.length
        ? t('providerModels.item.modelConfig.schemaPaste.unmapped', { inputs: unmapped.join(', ') })
        : undefined,
      message: t('providerModels.item.modelConfig.schemaPaste.applied', {
        count: Object.keys(parameters).length,
        type: modality,
      }),
      type: unmapped.length ? 'warning' : 'success',
    });
  };

  return (
    <Flexbox gap={8}>
      <TextArea
        autoSize={{ maxRows: 8, minRows: 4 }}
        placeholder={t('providerModels.item.modelConfig.schemaPaste.placeholder')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Flexbox align={'flex-start'}>
        <Button disabled={!value.trim()} size={'small'} onClick={apply}>
          {t('providerModels.item.modelConfig.schemaPaste.apply')}
        </Button>
      </Flexbox>
      {outcome && (
        <Alert
          showIcon
          description={outcome.detail}
          message={outcome.message}
          type={outcome.type}
        />
      )}
    </Flexbox>
  );
};

export default SchemaPasteField;
