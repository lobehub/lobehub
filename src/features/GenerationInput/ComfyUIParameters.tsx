'use client';

import { Flexbox } from '@lobehub/ui';
import { Input, Select, Text, TextArea } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

interface ComfyUIParametersProps {
  disabled?: boolean;
}

function TextParameter({
  disabled,
  name,
}: ComfyUIParametersProps & { name: 'negativePrompt' | 'samplerName' | 'scheduler' }) {
  const { t } = useTranslation('image');
  const { value, setValue, enumValues } = useGenerationConfigParam(name);
  const label = t(`config.${name}.label`);

  return (
    <Flexbox gap={6}>
      <Text fontSize={12}>{label}</Text>
      {name === 'negativePrompt' ? (
        <TextArea
          aria-label={label}
          disabled={disabled}
          rows={3}
          value={value ?? ''}
          onChange={(event) => setValue(event.target.value)}
        />
      ) : enumValues?.length ? (
        <Select
          aria-label={label}
          disabled={disabled}
          options={enumValues.map((item) => ({ label: item, value: item }))}
          value={value}
          onChange={setValue}
        />
      ) : (
        <Input
          aria-label={label}
          disabled={disabled}
          value={value ?? ''}
          onChange={(event) => setValue(event.target.value)}
        />
      )}
    </Flexbox>
  );
}

function StrengthParameter({ disabled }: ComfyUIParametersProps) {
  const { t } = useTranslation('image');
  const { value, setValue, min, max, step } = useGenerationConfigParam('strength');
  const label = t('config.strength.label');

  return (
    <Flexbox gap={6}>
      <Text fontSize={12}>{label}</Text>
      <Input
        aria-label={label}
        disabled={disabled}
        max={max ?? 1}
        min={min ?? 0}
        step={step ?? 0.05}
        type="number"
        value={value ?? ''}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next) && next >= (min ?? 0) && next <= (max ?? 1)) setValue(next);
        }}
      />
    </Flexbox>
  );
}

/** Additional controls are exposed only when the saved graph binds them. */
export function ComfyUIParameters({ disabled }: ComfyUIParametersProps) {
  const provider = useImageStore(imageGenerationConfigSelectors.provider);
  const schema = useImageStore(imageGenerationConfigSelectors.parametersSchema);
  if (provider !== 'comfyui') return null;

  return (
    <>
      {(['negativePrompt', 'samplerName', 'scheduler'] as const).map((name) =>
        schema[name] ? <TextParameter disabled={disabled} key={name} name={name} /> : null,
      )}
      {schema.strength && <StrengthParameter disabled={disabled} />}
    </>
  );
}
