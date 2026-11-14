'use client';

import { Flexbox, Input, Switch, Text, TextArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useMusicStore } from '@/store/music';
import { musicGenerationConfigSelectors } from '@/store/music/selectors';
import { useMusicGenerationConfigParam } from '@/store/music/slices/generationConfig/hooks';

import ReferenceAudio from './ReferenceAudio';

const styles = stylex.create({
  container: {
    marginBlockStart: '8px',
    paddingBlockStart: '8px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'dashed',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
});

const isSupported = musicGenerationConfigSelectors.isSupportedParam;

interface TextParamProps {
  disabled?: boolean;
  label: string;
  paramName: 'negativeStyle' | 'style' | 'title';
  placeholder: string;
}

const TextParam = memo<TextParamProps>(({ disabled, label, paramName, placeholder }) => {
  const { value, setValue, schema } = useMusicGenerationConfigParam(paramName);

  return (
    <Flexbox flex={1} gap={4} style={{ minWidth: 180 }}>
      <Text fontSize={12} type={'secondary'}>
        {label}
      </Text>
      <Input
        aria-label={label}
        disabled={disabled}
        maxLength={schema?.maxLength}
        placeholder={placeholder}
        size={'small'}
        value={value ?? ''}
        variant={'filled'}
        onChange={(e) => setValue(e.target.value)}
      />
    </Flexbox>
  );
});

TextParam.displayName = 'MusicTextParam';

interface SwitchParamProps {
  disabled?: boolean;
  label: string;
  paramName: 'autoLyrics' | 'instrumental';
}

const SwitchParam = memo<SwitchParamProps>(({ disabled, label, paramName }) => {
  const { value, setValue } = useMusicGenerationConfigParam(paramName);

  return (
    <Flexbox horizontal align={'center'} gap={6}>
      <Switch
        aria-label={label}
        checked={!!value}
        disabled={disabled}
        size={'small'}
        onChange={(checked) => setValue(checked)}
      />
      <Text fontSize={12}>{label}</Text>
    </Flexbox>
  );
});

SwitchParam.displayName = 'MusicSwitchParam';

const LyricsParam = memo<{ disabled?: boolean }>(({ disabled }) => {
  const { t } = useTranslation('music');
  const { value, setValue, schema } = useMusicGenerationConfigParam('lyrics');
  const { value: instrumental } = useMusicGenerationConfigParam('instrumental');
  const { value: autoLyrics } = useMusicGenerationConfigParam('autoLyrics');
  // Auto-written lyrics only apply to an empty lyrics box; filled text is sung as written
  const lyricsOverrideAutoLyrics = !!autoLyrics && !instrumental && !!value?.trim();

  return (
    <Flexbox gap={4}>
      <Text fontSize={12} type={'secondary'}>
        {t('config.lyrics.label')}
      </Text>
      <TextArea
        aria-label={t('config.lyrics.label')}
        autoSize={{ maxRows: 10, minRows: 2 }}
        disabled={disabled || !!instrumental}
        maxLength={schema?.maxLength}
        showCount={!!schema?.maxLength && !instrumental}
        value={value ?? ''}
        variant={'filled'}
        placeholder={
          instrumental ? t('config.lyrics.instrumentalHint') : t('config.lyrics.placeholder')
        }
        onChange={(e) => setValue(e.target.value)}
      />
      {lyricsOverrideAutoLyrics && (
        <Text fontSize={12} type={'warning'}>
          {t('config.lyrics.autoLyricsIgnored')}
        </Text>
      )}
    </Flexbox>
  );
});

LyricsParam.displayName = 'MusicLyricsParam';

interface MusicParamsProps {
  disabled?: boolean;
}

/**
 * Song details under the prompt. Every field is driven by the selected model's schema: a field
 * shows only when the model declares the matching parameter.
 */
const MusicParams = memo<MusicParamsProps>(({ disabled }) => {
  const { t } = useTranslation('music');
  const supportsTitle = useMusicStore(isSupported('title'));
  const supportsStyle = useMusicStore(isSupported('style'));
  const supportsNegativeStyle = useMusicStore(isSupported('negativeStyle'));
  const supportsLyrics = useMusicStore(isSupported('lyrics'));
  const supportsInstrumental = useMusicStore(isSupported('instrumental'));
  const supportsAutoLyrics = useMusicStore(isSupported('autoLyrics'));
  const supportsReferenceAudio = useMusicStore(isSupported('referenceAudioUrl'));

  const hasTextRow = supportsTitle || supportsStyle || supportsNegativeStyle;
  const hasSwitches = supportsInstrumental || supportsAutoLyrics;

  if (!hasTextRow && !supportsLyrics && !hasSwitches && !supportsReferenceAudio) return null;

  return (
    <Flexbox className={stylex.props(styles.container).className} gap={10}>
      {supportsReferenceAudio && <ReferenceAudio disabled={disabled} />}
      {hasTextRow && (
        <Flexbox horizontal gap={8} wrap={'wrap'}>
          {supportsTitle && (
            <TextParam
              disabled={disabled}
              label={t('config.title.label')}
              paramName={'title'}
              placeholder={t('config.title.placeholder')}
            />
          )}
          {supportsStyle && (
            <TextParam
              disabled={disabled}
              label={t('config.style.label')}
              paramName={'style'}
              placeholder={t('config.style.placeholder')}
            />
          )}
          {supportsNegativeStyle && (
            <TextParam
              disabled={disabled}
              label={t('config.negativeStyle.label')}
              paramName={'negativeStyle'}
              placeholder={t('config.negativeStyle.placeholder')}
            />
          )}
        </Flexbox>
      )}
      {supportsLyrics && <LyricsParam disabled={disabled} />}
      {hasSwitches && (
        <Flexbox horizontal align={'center'} gap={16} wrap={'wrap'}>
          {supportsInstrumental && (
            <SwitchParam
              disabled={disabled}
              label={t('config.instrumental.label')}
              paramName={'instrumental'}
            />
          )}
          {supportsAutoLyrics && (
            <SwitchParam
              disabled={disabled}
              label={t('config.autoLyrics.label')}
              paramName={'autoLyrics'}
            />
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

MusicParams.displayName = 'MusicParams';

export default MusicParams;
