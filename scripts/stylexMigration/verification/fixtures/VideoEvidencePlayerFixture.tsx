import { VideoEvidencePlayer } from 'verification:component';

export const Fixture = ({ variant }: { variant: string }) => (
  <VideoEvidencePlayer
    frameMaxHeight={variant === 'frame-height' ? '240px' : undefined}
    src="data:video/mp4;base64,"
  />
);
