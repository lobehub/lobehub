'use client';

import '@livekit/components-styles';

import {
  BarVisualizer,
  ControlBar,
  RoomAudioRenderer,
  RoomContext,
  StartAudio,
  TrackLoop,
  useTracks,
  useVoiceAssistant,
  VideoTrack,
} from '@livekit/components-react';
import { Flexbox } from '@lobehub/ui';
import { type Room, Track } from 'livekit-client';
import { useTranslation } from 'react-i18next';

const Media = ({ video }: { video: boolean }) => {
  const { t } = useTranslation('chat');
  const { state, audioTrack } = useVoiceAssistant();
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], {
    onlySubscribed: false,
  });
  return (
    <Flexbox data-lk-theme="default" gap={16} padding={16} style={{ width: 'min(520px, 85vw)' }}>
      <div aria-live="polite" role="status">
        {t(`voiceCall.agentState.${state}`)}
      </div>
      <BarVisualizer barCount={7} state={state} style={{ height: 96 }} trackRef={audioTrack} />
      {video && (
        <TrackLoop tracks={tracks}>
          <VideoTrack style={{ width: '100%', maxHeight: 240, objectFit: 'contain' }} />
        </TrackLoop>
      )}
      <RoomAudioRenderer />
      <StartAudio label={t('voiceCall.enableAudio')} />
      <ControlBar
        controls={{ microphone: true, camera: video, screenShare: video, chat: false, leave: true }}
      />
      {video && <small>{t('voiceCall.videoNotice')}</small>}
    </Flexbox>
  );
};

export const CallPanel = ({ room, video }: { room: Room; video: boolean }) => (
  <RoomContext value={room}>
    <Media video={video} />
  </RoomContext>
);
