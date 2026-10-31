import { SpendType } from 'verification:component';

const types = [
  'chat',
  'embedding',
  'imageGeneration',
  'speechRecognition',
  'textToSpeech',
  'videoGeneration',
] as const;

export const Fixture = ({ variant }: { variant: string }) => (
  <SpendType type={types.find((type) => type === variant) ?? 'chat'}>Usage type</SpendType>
);
