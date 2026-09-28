import { hashFileStream } from './stream';

export type HashWorkerRequest = { file: File };
export type HashWorkerResponse =
  | { type: 'progress'; progress: number }
  | { type: 'done'; hash: string }
  | { type: 'error'; message: string };

const post = (message: HashWorkerResponse) => self.postMessage(message);

self.addEventListener('message', async (event: MessageEvent<HashWorkerRequest>) => {
  try {
    const hash = await hashFileStream(event.data.file, undefined, (progress) =>
      post({ progress, type: 'progress' }),
    );
    post({ hash, type: 'done' });
  } catch (error) {
    post({ message: error instanceof Error ? error.message : String(error), type: 'error' });
  }
});
