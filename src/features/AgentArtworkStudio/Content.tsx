'use client';

import type { AgentArtworkComposition, AgentArtworkStyle } from '@lobechat/prompts';
import type { AgentProfile } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveAgentBackground } from '@/features/AgentProfileArtwork/utils';
import { ArtworkStudioContent, styleReferencesForArtworkStyle } from '@/features/ArtworkStudio';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { cutOutFullBodyArtwork } from '@/services/artworkGeneration';
import { useAgentStore } from '@/store/agent';
import { agentArtworkSelectors, agentSelectors } from '@/store/agent/selectors';
import { useFileStore } from '@/store/file';

import { generateCharacterSet } from './generateCharacterSet';

const MAX_AVATAR_SIZE = 1024 * 1024;

interface AgentArtworkStudioContentProps {
  agentId: string;
}

/**
 * Image models return an opaque JPEG, so the generated full-body artwork is cut
 * out and re-uploaded as a transparent PNG before it is stored — the home
 * surface composites it over its own background. A failed cut-out keeps the
 * original artwork rather than blocking the result.
 */
const useTransparentFullBody = () => {
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);

  return useCallback(
    async (url: string) => {
      const file = await cutOutFullBodyArtwork(url);
      if (!file) return url;

      try {
        const result = await uploadWithProgress({ file });

        return result?.url || url;
      } catch (error) {
        console.error('Failed to upload the transparent full-body artwork:', error);

        return url;
      }
    },
    [uploadWithProgress],
  );
};

const AgentArtworkStudioContent = memo<AgentArtworkStudioContentProps>(({ agentId }) => {
  const { t } = useTranslation('setting');
  const appOrigin = useAppOrigin();
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId));
  const fullBody = useAgentStore(agentSelectors.getAgentFullBodyArtworkById(agentId));
  const profile = useAgentStore(agentSelectors.getAgentProfileById(agentId));
  const storedAvatar = useAgentStore(agentSelectors.getAgentStoredAvatarById(agentId));
  const systemRole = useAgentStore(
    (s) => agentSelectors.getAgentConfigById(agentId)(s)?.systemRole,
  );
  const generation = useAgentStore(agentArtworkSelectors.generationByAgentId(agentId));
  const generateAgentArtwork = useAgentStore((s) => s.generateAgentArtwork);
  const cancelAgentArtworkGeneration = useAgentStore((s) => s.cancelAgentArtworkGeneration);
  const updateAgentMetaById = useAgentStore((s) => s.updateAgentMetaById);
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const toTransparentFullBody = useTransparentFullBody();

  const [uploading, setUploading] = useState(false);
  const [generatingTarget, setGeneratingTarget] = useState<AgentArtworkComposition | 'both'>();

  const generating = generation?.status === 'generating' && generation.kind === 'avatar';
  const generationFailed = generation?.status === 'error' && generation.kind === 'avatar';

  // `profile` is one jsonb bag, so a partial write has to merge rather than replace.
  const saveProfile = useCallback(
    (patch: Partial<AgentProfile>) =>
      updateAgentMetaById(agentId, { profile: { ...profile, ...patch } }),
    [agentId, profile, updateAgentMetaById],
  );

  const generate = useCallback(
    async (
      nextStyle: AgentArtworkStyle,
      composition?: AgentArtworkComposition,
      direction?: string,
      useReference?: boolean,
    ) => {
      // The user's own reference replaces the preset's images rather than joining
      // them: the two carry opposite instructions ("follow this character" vs
      // "borrow this look, invent a character"), and a model given both blends
      // them into neither.
      const customReference = useReference ? profile?.artworkReferenceImage : undefined;
      const commonInput = {
        description: meta.description,
        id: agentId,
        kind: 'avatar',
        name: meta.name,
        direction,
        referenceImageUrl: resolveAgentBackground(meta.backgroundColor),
        style: nextStyle,
        styleReferenceImageUrls: customReference
          ? [customReference]
          : styleReferencesForArtworkStyle(nextStyle, appOrigin),
        styleReferenceSource: customReference ? 'custom' : 'preset',
        systemRole,
        title: meta.title,
      } as const;

      setGeneratingTarget(composition ?? 'both');
      try {
        const result = await generateCharacterSet({
          composition,
          currentAvatarUrl: meta.avatar,
          generate: generateAgentArtwork,
          input: commonInput,
        });
        if (result.fullBodyUrl) {
          await saveProfile({
            artworkDirection: direction?.trim() || undefined,
            artworkStyle: nextStyle,
            fullBodyArtwork: await toTransparentFullBody(result.fullBodyUrl),
          });
        }
      } catch {
        // The Agent store owns the persistent error state rendered below.
      } finally {
        setGeneratingTarget(undefined);
      }
    },
    [
      agentId,
      appOrigin,
      generateAgentArtwork,
      meta.backgroundColor,
      meta.description,
      meta.avatar,
      meta.name,
      meta.title,
      profile?.artworkReferenceImage,
      saveProfile,
      systemRole,
      toTransparentFullBody,
    ],
  );

  /** Attaches the user's own generation reference, or clears it when called bare. */
  const changeReference = useCallback(
    async (file?: File) => {
      if (!file) {
        const { artworkReferenceImage: _cleared, ...rest } = profile ?? {};
        await updateAgentMetaById(agentId, { profile: rest });
        return;
      }

      if (file.size > MAX_AVATAR_SIZE) {
        toast.error(t('settingAgent.artwork.sizeExceeded'));
        return;
      }

      setUploading(true);
      try {
        const result = await uploadWithProgress({ file });
        if (!result?.url) throw new Error('Upload returned no URL');
        await saveProfile({ artworkReferenceImage: result.url });
      } catch (error) {
        console.error('Failed to upload artwork reference:', error);
        toast.error(t('settingAgent.artwork.uploadFailed'));
      } finally {
        setUploading(false);
      }
    },
    [agentId, profile, saveProfile, t, updateAgentMetaById, uploadWithProgress],
  );

  const remove = useCallback(
    async (composition: AgentArtworkComposition) => {
      try {
        if (composition === 'avatar') {
          await updateAgentMetaById(agentId, { avatar: null });
          return;
        }

        // Drop the key rather than storing an empty value, so the bag keeps
        // only what the agent actually has.
        const { fullBodyArtwork: _removed, ...rest } = profile ?? {};
        await updateAgentMetaById(agentId, { profile: rest });
      } catch (error) {
        console.error('Failed to remove agent artwork:', error);
        toast.error(t('settingAgent.artwork.uploadFailed'));
      }
    },
    [agentId, profile, t, updateAgentMetaById],
  );

  const upload = useCallback(
    async (file: File, composition: AgentArtworkComposition) => {
      if (file.size > MAX_AVATAR_SIZE) {
        toast.error(t('settingAgent.artwork.sizeExceeded'));
        return;
      }

      setUploading(true);
      try {
        const result = await uploadWithProgress({ file });
        if (!result?.url) throw new Error('Upload returned no URL');
        await cancelAgentArtworkGeneration(agentId);
        if (composition === 'avatar') await updateAgentMetaById(agentId, { avatar: result.url });
        else await saveProfile({ fullBodyArtwork: result.url });
      } catch (error) {
        console.error('Failed to upload agent avatar:', error);
        toast.error(t('settingAgent.artwork.uploadFailed'));
      } finally {
        setUploading(false);
      }
    },
    [
      agentId,
      cancelAgentArtworkGeneration,
      saveProfile,
      t,
      updateAgentMetaById,
      uploadWithProgress,
    ],
  );

  return (
    <ArtworkStudioContent
      avatar={meta.avatar}
      fullBody={fullBody}
      generating={generating}
      generatingTarget={generatingTarget}
      generatingTitle={t('settingAgent.artwork.avatar.generating')}
      generationFailed={generationFailed}
      hasStoredAvatar={!!storedAvatar}
      initialDirection={profile?.artworkDirection}
      initialStyle={profile?.artworkStyle}
      referenceImage={profile?.artworkReferenceImage}
      uploading={uploading}
      onCancel={() => void cancelAgentArtworkGeneration(agentId)}
      onGenerate={generate}
      onReferenceChange={(file) => void changeReference(file)}
      onRemove={(composition) => void remove(composition)}
      onUpload={(file, composition) => void upload(file, composition)}
    />
  );
});

AgentArtworkStudioContent.displayName = 'AgentArtworkStudioContent';

export default AgentArtworkStudioContent;
