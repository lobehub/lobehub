import { asrService } from '@/services/asr';
import { getUserStoreState } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

/**
 * Turn an uploaded voice recording into the text of its turn.
 *
 * Heterogeneous agents (Claude Code, Codex, …) only take a text prompt, so a voice turn is sent
 * as its transcript. The recording stays attached for playback, but the transcript is what gets
 * persisted as the user message content and what the external CLI receives.
 */
export const transcribeVoiceMessage = async (fileId: string, signal?: AbortSignal) => {
  const { model, provider } = systemAgentSelectors.asr(getUserStoreState());
  if (!model || !provider) throw new Error('No speech-to-text model is configured');

  const { text } = await asrService.transcribeFile({ fileId, model, provider }, signal);

  const transcript = text.trim();
  if (!transcript) throw new Error('Voice message transcript is empty');

  return transcript;
};
