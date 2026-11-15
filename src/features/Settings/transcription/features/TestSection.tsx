'use client';

import type { LocalAsrStatus, TranscriptionProvider } from '@lobechat/electron-client-ipc';
import { Button, Flexbox, Progress, Tag, Text, toast } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import { FileAudio, Mic, Square, Users } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import {
  BrowserAudioWorkletCapture,
  type RealtimeAudioCapture,
  requestDictationMicrophone,
} from '@/features/ChatInput/Dictation/audio';
import { electronLocalAsrService } from '@/services/electron/localAsr';
import {
  type BatchTranscriptionPhase,
  type BatchTranscriptionResult,
  createLocalBatchTranscriber,
  createRealtimeTranscriber,
  type RealtimeTranscriber,
  type RealtimeTranscriberStats,
  resolveTranscriptionProvider,
  type TranscriptSegment,
} from '@/services/transcriber';

const formatClock = (ms = 0) => {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

const formatSeconds = (ms = 0) => `${(ms / 1000).toFixed(1)}s`;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const TranscriptLines = ({
  partial,
  segments,
}: {
  partial?: TranscriptSegment;
  segments: TranscriptSegment[];
}) => {
  const { t } = useTranslation('setting');
  if (segments.length === 0 && !partial) return null;

  return (
    <Flexbox
      data-testid={'local-asr-transcript'}
      gap={4}
      style={{ maxHeight: 280, overflowY: 'auto', width: '100%' }}
    >
      {segments.map((segment) => (
        <Text key={segment.id}>
          <Text as={'span'} type={'secondary'}>
            [{formatClock(segment.startMs)}]{' '}
            {segment.speaker &&
              `${t('localAsr.test.speaker', { index: segment.speaker.replace('speaker_', '') })}: `}
          </Text>
          {segment.text}
        </Text>
      ))}
      {partial && (
        <Text type={'secondary'}>
          [{formatClock(partial.startMs)}] {partial.text}
        </Text>
      )}
    </Flexbox>
  );
};

const LiveTest = ({
  language,
  onRecorded,
  provider,
}: {
  language: string;
  onRecorded: (audioPath: string) => void;
  provider: TranscriptionProvider;
}) => {
  const { t } = useTranslation('setting');
  const [running, setRunning] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [partial, setPartial] = useState<TranscriptSegment>();
  const [stats, setStats] = useState<RealtimeTranscriberStats>();
  const session = useRef<{ capture: RealtimeAudioCapture; transcriber: RealtimeTranscriber }>(
    undefined,
  );

  const stop = async () => {
    const current = session.current;
    session.current = undefined;
    if (!current) return;
    await current.capture.stop();
    const result = await current.transcriber.stop();
    setPartial(undefined);
    setStats(result.stats);
    if (result.audioPath) onRecorded(result.audioPath);
    setRunning(false);
  };

  const start = async () => {
    setSegments([]);
    setPartial(undefined);
    setStats(undefined);
    const transcriber = createRealtimeTranscriber(provider);
    try {
      await transcriber.start({
        language,
        onError: (error) =>
          toast.error(t('localAsr.error', { message: error.message ?? error.code })),
        onFinal: (segment) => {
          setPartial(undefined);
          setSegments((prev) => [...prev, segment]);
        },
        onPartial: setPartial,
        // Local only: keep a WAV on this device so the recording can be refined with speakers.
        recordAudio: provider === 'local',
      });
      const capture = await BrowserAudioWorkletCapture.create(await requestDictationMicrophone());
      session.current = { capture, transcriber };
      setRunning(true);
      await capture.start(
        (frame) => transcriber.pushFrame(frame),
        () => void stop(),
      );
    } catch (error) {
      await transcriber.cancel().catch(() => undefined);
      session.current = undefined;
      setRunning(false);
      toast.error(t('localAsr.error', { message: errorMessage(error) }));
    }
  };

  return (
    <Flexbox align={'flex-end'} gap={8} style={{ width: '100%' }}>
      <Tag
        color={provider === 'local' ? 'success' : 'processing'}
        data-testid={'local-asr-live-engine'}
      >
        {t(`localAsr.test.engine.${provider}`)}
      </Tag>
      <Button
        danger={running}
        icon={running ? Square : Mic}
        type={running ? 'default' : 'primary'}
        onClick={running ? stop : start}
      >
        {running ? t('localAsr.test.live.stop') : t('localAsr.test.live.start')}
      </Button>
      {running && segments.length === 0 && !partial && (
        <Text type={'secondary'}>{t('localAsr.test.live.listening')}</Text>
      )}
      <TranscriptLines partial={partial} segments={segments} />
      {stats && (
        <Text data-testid={'local-asr-live-stats'} fontSize={12} type={'secondary'}>
          {t('localAsr.test.liveStats', {
            audio: formatSeconds(stats.audioMs),
            p50: stats.decodeP50Ms ?? '--',
            rtf: stats.rtf ?? '--',
          })}
        </Text>
      )}
    </Flexbox>
  );
};

const FileTest = ({
  diarize,
  language,
  recordingPath,
}: {
  diarize: boolean;
  language: string;
  recordingPath?: string;
}) => {
  const { t } = useTranslation('setting');
  const [progress, setProgress] = useState<{ phase: BatchTranscriptionPhase; progress: number }>();
  const [result, setResult] = useState<BatchTranscriptionResult>();

  const transcribe = async (filePath: string) => {
    setResult(undefined);
    setProgress({ phase: 'loading', progress: 0 });
    try {
      setResult(
        await createLocalBatchTranscriber().transcribe({
          diarize,
          filePath,
          language,
          onProgress: setProgress,
        }),
      );
    } catch (error) {
      toast.error(t('localAsr.error', { message: errorMessage(error) }));
    } finally {
      setProgress(undefined);
    }
  };

  const pickAndTranscribe = async () => {
    const filePath = await electronLocalAsrService.pickAudioFile(t('localAsr.test.file.pick'));
    if (filePath) await transcribe(filePath);
  };

  const stats = result?.stats;
  return (
    <Flexbox align={'flex-end'} gap={8} style={{ width: '100%' }}>
      <Flexbox horizontal gap={8}>
        {recordingPath && (
          <Button icon={Users} loading={!!progress} onClick={() => transcribe(recordingPath)}>
            {t('localAsr.test.file.refineRecording')}
          </Button>
        )}
        <Button icon={FileAudio} loading={!!progress} onClick={pickAndTranscribe}>
          {t('localAsr.test.file.pick')}
        </Button>
      </Flexbox>
      {!diarize && (
        <Text fontSize={12} type={'secondary'}>
          {t('localAsr.test.file.noDiarization')}
        </Text>
      )}
      {progress && (
        <Flexbox gap={2} style={{ width: 280 }}>
          <Progress percent={Math.round(progress.progress * 100)} size={'small'} />
          <Text fontSize={12} type={'secondary'}>
            {t(`localAsr.test.phase.${progress.phase}`)}
          </Text>
        </Flexbox>
      )}
      {result && <TranscriptLines segments={result.segments} />}
      {stats && (
        <Text data-testid={'local-asr-file-stats'} fontSize={12} type={'secondary'}>
          {t('localAsr.test.fileStats', {
            audio: formatSeconds(result.audioMs),
            elapsed: formatSeconds(Number(stats.totalMs)),
            rss: stats.peakRssMb,
            rtf: stats.rtf,
          })}
        </Text>
      )}
    </Flexbox>
  );
};

const TestSection = ({ status }: { status: LocalAsrStatus }) => {
  const { t } = useTranslation('setting');
  const form = useForm();
  const asrReady = status.packs.find((pack) => pack.id === 'asr-sensevoice')?.status === 'ready';
  const diarizationReady =
    status.packs.find((pack) => pack.id === 'diarization')?.status === 'ready';
  const { language, diarization } = status.preferences;
  const provider = resolveTranscriptionProvider(status);
  const [recordingPath, setRecordingPath] = useState<string>();
  const liveItem = {
    children: (
      <LiveTest
        key={provider}
        language={language}
        provider={provider}
        onRecorded={setRecordingPath}
      />
    ),
    desc: t('localAsr.test.live.desc'),
    label: t('localAsr.test.live.title'),
    layout: 'vertical' as const,
    minWidth: undefined,
  };

  const group: FormGroupItem = {
    children: asrReady
      ? [
          liveItem,
          {
            children: (
              <FileTest
                diarize={diarization && diarizationReady}
                language={language}
                recordingPath={recordingPath}
              />
            ),
            desc: t('localAsr.test.file.desc'),
            label: t('localAsr.test.file.title'),
            layout: 'vertical',
            minWidth: undefined,
          },
        ]
      : provider === 'cloud'
        ? [liveItem]
        : [
            {
              children: <Text type={'secondary'}>{t('localAsr.test.needModel')}</Text>,
              label: t('localAsr.test.live.title'),
              minWidth: undefined,
            },
          ],
    desc: t('localAsr.test.desc'),
    title: t('localAsr.test.title'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      items={[group]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
};

export default TestSection;
