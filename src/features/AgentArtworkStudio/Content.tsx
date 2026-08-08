'use client';

import {
  AGENT_ARTWORK_STYLES,
  type AgentArtworkStyle,
  DEFAULT_AGENT_ARTWORK_STYLE,
} from '@lobechat/prompts';
import { Alert, Avatar, Center, Flexbox, Tag, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { UploadIcon, WandSparkles } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { openFilePicker, resolveAgentBackground } from '@/features/AgentProfileArtwork/utils';
import { useAgentStore } from '@/store/agent';
import { agentArtworkSelectors, agentSelectors } from '@/store/agent/selectors';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/selectors';
import { useFileStore } from '@/store/file';

import {
  LOBE_STYLE_REFERENCE_IMAGE_URLS,
  styleReferencesForArtworkStyle,
} from './lobeStyleReferences';

const MAX_AVATAR_SIZE = 1024 * 1024;

const styles = createStaticStyles(({ css }) => ({
  generationOverlay: css`
    position: absolute;
    z-index: 2;
    inset: 0;

    border-radius: calc(${cssVar.borderRadiusLG} - 1px);

    background: color-mix(in srgb, ${cssVar.colorBgContainer} 88%, transparent);
    backdrop-filter: blur(12px);
  `,
  hint: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  lobeCard: css`
    cursor: pointer;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};

    transition:
      border-color ${cssVar.motionDurationFast},
      background ${cssVar.motionDurationFast};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  lobeCardActive: css`
    border-color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};

    &:hover {
      background: ${cssVar.colorPrimaryBg};
    }
  `,
  preview: css`
    position: relative;

    overflow: hidden;
    flex: none;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  sectionTitle: css`
    font-weight: 500;
  `,
  visuallyHiddenInput: css`
    pointer-events: none;

    position: fixed;

    overflow: hidden;

    width: 1px;
    height: 1px;

    opacity: 0;
  `,
}));

interface AgentArtworkStudioContentProps {
  agentId: string;
}

const AgentArtworkStudioContent = memo<AgentArtworkStudioContentProps>(({ agentId }) => {
  const { t } = useTranslation('setting');
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId));
  const systemRole = useAgentStore(
    (s) => agentSelectors.getAgentConfigById(agentId)(s)?.systemRole,
  );
  const generation = useAgentStore(agentArtworkSelectors.generationByAgentId(agentId));
  const generateAgentArtwork = useAgentStore((s) => s.generateAgentArtwork);
  const cancelAgentArtworkGeneration = useAgentStore((s) => s.cancelAgentArtworkGeneration);
  const updateAgentMetaById = useAgentStore((s) => s.updateAgentMetaById);
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const canGenerate = useAiInfraStore(
    (state) => aiProviderSelectors.enabledImageModelList(state).length > 0,
  );

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [style, setStyle] = useState<AgentArtworkStyle>(DEFAULT_AGENT_ARTWORK_STYLE);

  const generating = generation?.status === 'generating' && generation.kind === 'avatar';
  const generationError = generation?.status === 'error' && generation.kind === 'avatar';

  const generate = useCallback(
    (nextStyle: AgentArtworkStyle) => {
      generateAgentArtwork({
        description: meta.description,
        id: agentId,
        kind: 'avatar',
        name: meta.name,
        referenceImageUrl: resolveAgentBackground(meta.backgroundColor),
        style: nextStyle,
        styleReferenceImageUrls: styleReferencesForArtworkStyle(nextStyle),
        systemRole,
        title: meta.title,
      }).catch(() => {
        // The Agent store owns the persistent error state rendered below.
      });
    },
    [
      agentId,
      generateAgentArtwork,
      meta.backgroundColor,
      meta.description,
      meta.name,
      meta.title,
      systemRole,
    ],
  );

  const upload = useCallback(
    async (file: File) => {
      if (file.size > MAX_AVATAR_SIZE) {
        toast.error(t('settingAgent.artwork.sizeExceeded'));
        return;
      }

      setUploading(true);
      try {
        const result = await uploadWithProgress({ file });
        if (!result?.url) throw new Error('Upload returned no URL');
        await updateAgentMetaById(agentId, { avatar: result.url });
      } catch (error) {
        console.error('Failed to upload agent avatar:', error);
        toast.error(t('settingAgent.artwork.uploadFailed'));
      } finally {
        setUploading(false);
      }
    },
    [agentId, t, updateAgentMetaById, uploadWithProgress],
  );

  return (
    <Flexbox horizontal gap={32} padding={24} wrap={'wrap'}>
      {/* DIY path: the live avatar plus upload. The preview doubles as the
          generation stage so both paths land on the same picture. */}
      <Flexbox gap={16} style={{ flex: 'none', width: 232 }}>
        <Center className={styles.preview} height={232} width={232}>
          <Avatar avatar={meta.avatar || undefined} shape={'square'} size={180} />
          {generating ? (
            <Center className={styles.generationOverlay}>
              <Flexbox align={'center'} gap={10}>
                <NeuralNetworkLoading size={32} />
                <Flexbox align={'center'} gap={4}>
                  <Text className={styles.sectionTitle}>
                    {t('settingAgent.artwork.avatar.generating')}
                  </Text>
                  <Text className={styles.hint} style={{ textAlign: 'center' }}>
                    {t('settingAgent.artwork.generatingHint')}
                  </Text>
                  <Button
                    size={'small'}
                    style={{ marginBlockStart: 4 }}
                    type={'fill'}
                    onClick={() => void cancelAgentArtworkGeneration(agentId)}
                  >
                    {t('settingAgent.artwork.cancel')}
                  </Button>
                </Flexbox>
              </Flexbox>
            </Center>
          ) : null}
        </Center>
        <Flexbox gap={8}>
          <Text className={styles.sectionTitle}>{t('settingAgent.artwork.studio.diyTitle')}</Text>
          <Text className={styles.hint}>{t('settingAgent.artwork.studio.diyHint')}</Text>
          <Button
            icon={UploadIcon}
            loading={uploading}
            onClick={() => {
              const input = uploadInputRef.current;
              if (input) openFilePicker(input);
            }}
          >
            {t('settingAgent.artwork.studio.upload')}
          </Button>
        </Flexbox>
      </Flexbox>

      {/* One-click path: brand style first, the text-only presets behind it. */}
      <Flexbox gap={16} style={{ flex: 1, minWidth: 280 }}>
        <Flexbox gap={4}>
          <Text className={styles.sectionTitle}>
            {t('settingAgent.artwork.studio.generateTitle')}
          </Text>
          <Text className={styles.hint}>{t('settingAgent.artwork.studio.generateHint')}</Text>
        </Flexbox>

        <Flexbox
          horizontal
          align={'center'}
          className={`${styles.lobeCard} ${style === 'lobe' ? styles.lobeCardActive : ''}`}
          gap={12}
          padding={12}
          role={'button'}
          tabIndex={0}
          onClick={() => setStyle('lobe')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setStyle('lobe');
            }
          }}
        >
          <Flexbox horizontal flex={'none'} gap={4}>
            {LOBE_STYLE_REFERENCE_IMAGE_URLS.map((url) => (
              <Avatar avatar={url} key={url} shape={'square'} size={40} />
            ))}
          </Flexbox>
          <Flexbox gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={8}>
              <Text className={styles.sectionTitle}>
                {t('settingAgent.artwork.studio.lobeStyle')}
              </Text>
              <Tag color={'processing'} size={'small'}>
                {t('settingAgent.artwork.studio.recommended')}
              </Tag>
            </Flexbox>
            <Text ellipsis className={styles.hint}>
              {t('settingAgent.artwork.style.lobe')}
            </Text>
          </Flexbox>
        </Flexbox>

        <Flexbox gap={8}>
          <Text className={styles.hint}>{t('settingAgent.artwork.studio.moreStyles')}</Text>
          <Flexbox horizontal gap={8} wrap={'wrap'}>
            {AGENT_ARTWORK_STYLES.filter((item) => item !== 'lobe').map((item) => (
              <Button
                key={item}
                size={'small'}
                type={style === item ? 'primary' : 'fill'}
                onClick={() => setStyle(item)}
              >
                {t(`settingAgent.artwork.style.${item}`)}
              </Button>
            ))}
          </Flexbox>
        </Flexbox>

        <Flexbox gap={8} style={{ marginBlockStart: 'auto' }}>
          {generationError ? (
            <Alert showIcon title={t('settingAgent.artwork.generateFailed')} type={'error'} />
          ) : null}
          <Button
            disabled={!canGenerate || generating}
            icon={WandSparkles}
            type={'primary'}
            onClick={() => generate(style)}
          >
            {t('settingAgent.artwork.studio.generate')}
          </Button>
          {!canGenerate ? (
            <Text className={styles.hint}>{t('settingAgent.artwork.studio.noModel')}</Text>
          ) : null}
        </Flexbox>
      </Flexbox>

      <input
        accept="image/*"
        aria-label={t('settingAgent.artwork.studio.upload')}
        className={styles.visuallyHiddenInput}
        ref={uploadInputRef}
        tabIndex={-1}
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />
    </Flexbox>
  );
});

AgentArtworkStudioContent.displayName = 'AgentArtworkStudioContent';

export default AgentArtworkStudioContent;
