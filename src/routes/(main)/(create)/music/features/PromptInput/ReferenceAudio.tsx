'use client';

import { ActionIcon, Button, Flexbox, Input, Tag, Text, toast } from '@lobehub/ui';
import { Trash2Icon, UploadIcon } from 'lucide-react';
import { type ChangeEvent, memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AudioPlayer from '@/features/AudioPlayer';
import { useFileStore } from '@/store/file';
import { useMusicStore } from '@/store/music';
import { musicGenerationConfigSelectors } from '@/store/music/selectors';
import { useMusicGenerationConfigParam } from '@/store/music/slices/generationConfig/hooks';

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const fileNameOf = (url: string) => {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || url);
  } catch {
    return url;
  }
};

interface ReferenceAudioProps {
  disabled?: boolean;
}

/**
 * Reference track for models that cover or follow one: upload a file or paste a URL. The
 * constraints come from the model's `referenceAudioUrl` schema.
 */
const ReferenceAudio = memo<ReferenceAudioProps>(({ disabled }) => {
  const { t } = useTranslation('music');
  const { value, setValue, schema } = useMusicGenerationConfigParam('referenceAudioUrl');
  const uploading = useMusicStore(musicGenerationConfigSelectors.uploadingReferenceAudio);
  const setUploading = useMusicStore((s) => s.setUploadingReferenceAudio);
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const inputRef = useRef<HTMLInputElement>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [urlError, setUrlError] = useState(false);

  const maxFileSize = schema?.maxFileSize;
  const maxSizeMb = maxFileSize ? Math.round(maxFileSize / 1024 / 1024) : undefined;

  const hint =
    schema?.minDuration && schema?.maxDuration && maxSizeMb
      ? t('config.referenceAudio.hint', {
          max: String(schema.maxDuration),
          min: String(schema.minDuration),
          size: String(maxSizeMb),
        })
      : undefined;

  const handleFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      if (maxFileSize && file.size > maxFileSize) {
        toast.error(t('config.referenceAudio.tooLarge', { size: String(maxSizeMb) }));
        return;
      }

      setUploading(file.name);
      try {
        const result = await uploadWithProgress({
          file,
          onStatusUpdate: () => {},
          skipCheckFileType: true,
        });
        if (!result?.url) throw new Error('upload returned no url');
        setValue(result.url);
      } catch (error) {
        console.error('Failed to upload reference audio:', error);
        toast.error(t('config.referenceAudio.uploadFailed'));
      } finally {
        setUploading(undefined);
      }
    },
    [maxFileSize, maxSizeMb, setUploading, setValue, t, uploadWithProgress],
  );

  const commitUrl = useCallback(() => {
    const next = urlDraft.trim();
    if (!next) return;
    if (!isHttpUrl(next)) {
      setUrlError(true);
      return;
    }
    setUrlError(false);
    setUrlDraft('');
    setValue(next);
  }, [setValue, urlDraft]);

  return (
    <Flexbox gap={6}>
      <Flexbox horizontal align={'center'} gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {t('config.referenceAudio.label')}
        </Text>
        {schema?.required && (
          <Tag size={'small'} variant={'borderless'}>
            {t('config.referenceAudio.required')}
          </Tag>
        )}
        {hint && (
          <Text fontSize={12} type={'secondary'}>
            · {hint}
          </Text>
        )}
      </Flexbox>
      {value ? (
        <Flexbox horizontal align={'center'} gap={8}>
          <AudioPlayer alt={fileNameOf(value)} url={value} />
          <ActionIcon
            disabled={disabled}
            icon={Trash2Icon}
            size={'small'}
            title={t('config.referenceAudio.remove')}
            onClick={() => setValue(null)}
          />
        </Flexbox>
      ) : (
        <Flexbox horizontal align={'flex-start'} gap={8} wrap={'wrap'}>
          <Button
            disabled={disabled}
            icon={UploadIcon}
            loading={!!uploading}
            size={'small'}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? t('config.referenceAudio.uploading') : t('config.referenceAudio.upload')}
          </Button>
          <Flexbox flex={1} gap={2} style={{ minWidth: 200 }}>
            <Input
              disabled={disabled || !!uploading}
              placeholder={t('config.referenceAudio.urlPlaceholder')}
              size={'small'}
              value={urlDraft}
              variant={'filled'}
              onBlur={commitUrl}
              onPressEnter={commitUrl}
              onChange={(e) => {
                setUrlDraft(e.target.value);
                if (urlError) setUrlError(false);
              }}
            />
            {urlError && (
              <Text fontSize={12} type={'danger'}>
                {t('config.referenceAudio.invalidUrl')}
              </Text>
            )}
          </Flexbox>
          <input
            accept={'audio/*'}
            ref={inputRef}
            style={{ display: 'none' }}
            type={'file'}
            onChange={handleFile}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
});

ReferenceAudio.displayName = 'ReferenceAudio';

export default ReferenceAudio;
