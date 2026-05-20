'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { Divider, Input, Switch } from 'antd';
import { Music2Icon, SendIcon } from 'lucide-react';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAudioStore } from '@/store/audio';
import { audioGenerationConfigSelectors } from '@/store/audio/slices/generationConfig/selectors';

const useStyles = createStaticStyles(({ css, token }) => ({
  container: css`
    width: 100%;
    max-width: 680px;
    margin: 0 auto;
    padding: 24px 16px 16px;
  `,
  title: css`
    font-size: 28px;
    font-weight: 700;
    text-align: center;
    margin-bottom: 8px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  `,
  subtitle: css`
    text-align: center;
    color: ${token.colorTextSecondary};
    margin-bottom: 24px;
    font-size: 14px;
  `,
  modeSwitch: css`
    padding: 12px 16px;
    background: ${token.colorFillSecondary};
    border-radius: 12px;
    margin-bottom: 16px;
  `,
  textArea: css`
    border-radius: 12px;
    resize: none;
    font-size: 15px;
  `,
  charCount: css`
    font-size: 12px;
    color: ${token.colorTextQuaternary};
    text-align: right;
    margin-top: 4px;
  `,
  generateBtn: css`
    border-radius: 12px;
    height: 48px;
    font-size: 16px;
    font-weight: 600;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    box-shadow: 0 4px 14px 0 rgba(102, 126, 234, 0.39);

    &:hover {
      opacity: 0.9;
    }
  `,
}));

interface PromptInputProps {
  disableAnimation?: boolean;
  showTitle?: boolean;
}

const PromptInput = memo<PromptInputProps>(({ showTitle = false }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('audio');

  const prompt = useAudioStore(audioGenerationConfigSelectors.prompt);
  const customMode = useAudioStore(audioGenerationConfigSelectors.customMode);
  const songTitle = useAudioStore(audioGenerationConfigSelectors.songTitle);
  const stylePrompt = useAudioStore(audioGenerationConfigSelectors.stylePrompt);
  const makeInstrumental = useAudioStore(audioGenerationConfigSelectors.makeInstrumental);
  const isGenerating = useAudioStore((s) => s.isGenerating);

  const setPrompt = useAudioStore((s) => s.setPrompt);
  const setCustomMode = useAudioStore((s) => s.setCustomMode);
  const setSongTitle = useAudioStore((s) => s.setSongTitle);
  const setStylePrompt = useAudioStore((s) => s.setStylePrompt);
  const setMakeInstrumental = useAudioStore((s) => s.setMakeInstrumental);
  const generateAudio = useAudioStore((s) => s.generateAudio);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    await generateAudio();
  }, [prompt, isGenerating, generateAudio]);

  const MAX_PROMPT = customMode ? 2000 : 500;

  return (
    <div className={styles.container}>
      {showTitle && (
        <>
          <div className={styles.title}>Generate Music</div>
          <div className={styles.subtitle}>
            {customMode
              ? 'Provide your own lyrics and style for full creative control'
              : 'Describe the music and let AI handle the rest'}
          </div>
        </>
      )}

      {/* Custom / Non-custom toggle */}
      <Flexbox
        align="center"
        className={styles.modeSwitch}
        horizontal
        justify="space-between"
      >
        <Flexbox gap={6} horizontal align="center">
          <Music2Icon size={16} />
          <Text weight={600}>Custom Mode</Text>
          <Text style={{ fontSize: 12 }} type="secondary">
            {customMode ? 'Lyrics + Style' : 'Description only'}
          </Text>
        </Flexbox>
        <Switch checked={customMode} onChange={setCustomMode} size="small" />
      </Flexbox>

      {/* Main prompt area */}
      {customMode ? (
        <>
          <Input
            maxLength={100}
            placeholder="Song title (optional)"
            style={{ borderRadius: 10, marginBottom: 10 }}
            value={songTitle}
            onChange={(e) => setSongTitle(e.target.value)}
          />
          <Input.TextArea
            autoSize={{ minRows: 4, maxRows: 12 }}
            className={styles.textArea}
            maxLength={MAX_PROMPT}
            placeholder="Enter your lyrics here..."
            style={{ marginBottom: 6 }}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className={styles.charCount}>
            {prompt.length} / {MAX_PROMPT}
          </div>
          <Input
            maxLength={200}
            placeholder="Music style (e.g. upbeat pop, lo-fi hip-hop, cinematic orchestral)"
            style={{ borderRadius: 10, marginTop: 10 }}
            value={stylePrompt}
            onChange={(e) => setStylePrompt(e.target.value)}
          />
        </>
      ) : (
        <>
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 8 }}
            className={styles.textArea}
            maxLength={MAX_PROMPT}
            placeholder="Describe your music... e.g. 'A calm lo-fi hip-hop track with soft piano and warm beats for studying'"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className={styles.charCount}>
            {prompt.length} / {MAX_PROMPT}
          </div>
        </>
      )}

      <Divider style={{ margin: '14px 0' }} />

      {/* Instrumental toggle */}
      <Flexbox align="center" horizontal justify="space-between" style={{ marginBottom: 16 }}>
        <Text>Instrumental (no vocals)</Text>
        <Switch
          checked={makeInstrumental}
          onChange={setMakeInstrumental}
          size="small"
        />
      </Flexbox>

      {/* Generate button */}
      <ActionIcon
        active
        block
        className={styles.generateBtn}
        disabled={!prompt.trim() || isGenerating}
        icon={SendIcon}
        loading={isGenerating}
        size={{ blockSize: 48, fontSize: 16 }}
        title={isGenerating ? 'Generating...' : 'Generate Music'}
        onClick={handleGenerate}
      />

      {isGenerating && (
        <Text style={{ textAlign: 'center', marginTop: 10, fontSize: 13 }} type="secondary">
          Starting generation — your track will appear in the feed below
        </Text>
      )}
    </div>
  );
});

PromptInput.displayName = 'AudioPromptInput';

export default PromptInput;
