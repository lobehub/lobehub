'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Switch } from 'antd';
import { createStaticStyles } from 'antd-style';
import { InfoIcon, MicOffIcon, Music2Icon } from 'lucide-react';
import { memo } from 'react';

import { useAudioStore } from '@/store/audio';
import { audioGenerationConfigSelectors } from '@/store/audio/slices/generationConfig/selectors';

const useStyles = createStaticStyles(({ css, token }) => ({
  section: css`
    padding: 16px;
    border-radius: 12px;
    background: ${token.colorFillTertiary};
    margin-bottom: 12px;
  `,
  label: css`
    font-size: 12px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  `,
  hint: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
    margin-top: 4px;
    line-height: 1.5;
  `,
}));

const ConfigPanel = memo(() => {
  const { styles } = useStyles();

  const customMode = useAudioStore(audioGenerationConfigSelectors.customMode);
  const makeInstrumental = useAudioStore(audioGenerationConfigSelectors.makeInstrumental);

  const setCustomMode = useAudioStore((s) => s.setCustomMode);
  const setMakeInstrumental = useAudioStore((s) => s.setMakeInstrumental);

  return (
    <Flexbox gap={0} padding={16} style={{ overflowY: 'auto', height: '100%' }}>
      {/* Mode section */}
      <div className={styles.section}>
        <div className={styles.label}>Generation Mode</div>
        <Flexbox align="center" horizontal justify="space-between">
          <Flexbox gap={6} horizontal align="center">
            <Music2Icon size={14} />
            <Text weight={500}>{customMode ? 'Custom' : 'Description'}</Text>
          </Flexbox>
          <Switch checked={customMode} onChange={setCustomMode} size="small" />
        </Flexbox>
        <div className={styles.hint}>
          {customMode
            ? 'You provide lyrics and style — full creative control'
            : 'Describe what you want — AI handles everything'}
        </div>
      </div>

      {/* Vocals section */}
      <div className={styles.section}>
        <div className={styles.label}>Vocals</div>
        <Flexbox align="center" horizontal justify="space-between">
          <Flexbox gap={6} horizontal align="center">
            <MicOffIcon size={14} />
            <Text weight={500}>Instrumental</Text>
          </Flexbox>
          <Switch checked={makeInstrumental} onChange={setMakeInstrumental} size="small" />
        </Flexbox>
        <div className={styles.hint}>
          {makeInstrumental ? 'No vocals — music only' : 'AI will add vocals if appropriate'}
        </div>
      </div>

      {/* Info section */}
      <div className={styles.section}>
        <Flexbox gap={6} horizontal align="flex-start">
          <InfoIcon size={14} style={{ marginTop: 2, flexShrink: 0 }} />
          <div className={styles.hint}>
            Generation typically takes 20–60 seconds. You can listen while it&apos;s still
            processing after the first 15 seconds.
          </div>
        </Flexbox>
      </div>

      {/* Tips */}
      {!customMode && (
        <div className={styles.section}>
          <div className={styles.label}>Prompt Tips</div>
          <div className={styles.hint}>
            <strong>Genre:</strong> lo-fi, jazz, pop, orchestral…
            <br />
            <strong>Mood:</strong> calm, energetic, melancholic, uplifting…
            <br />
            <strong>Instruments:</strong> piano, guitar, synths, strings…
            <br />
            <strong>Purpose:</strong> studying, workout, relaxing, gaming…
          </div>
        </div>
      )}

      {customMode && (
        <div className={styles.section}>
          <div className={styles.label}>Style Tips</div>
          <div className={styles.hint}>
            Enter comma-separated genre/mood tags in the style field.
            <br />
            <em>Example: "jazz, bossa nova, smooth, saxophone"</em>
          </div>
        </div>
      )}
    </Flexbox>
  );
});

ConfigPanel.displayName = 'AudioConfigPanel';

export default ConfigPanel;
