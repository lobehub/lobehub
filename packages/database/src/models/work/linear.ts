import type {
  LinearWorkPatchField,
  LinearWorkVersionSnapshot,
  RegisterLinearWorkParams,
} from '@lobechat/types';

import { createSnapshotWorkAdapter, createSnapshotWorkRegister } from './snapshotWork';

export const linearSnapshot = (
  params: RegisterLinearWorkParams,
  previous?: LinearWorkVersionSnapshot | null,
): { linear: LinearWorkVersionSnapshot } => {
  const patchFields = new Set(params.patchFields ?? []);
  const pick = <T>(field: LinearWorkPatchField, value: T | null | undefined, fallback: T) =>
    patchFields.has(field)
      ? (value ?? fallback)
      : ((previous?.[field] as T | undefined) ?? fallback);

  return {
    linear: {
      description: pick('description', params.description, null),
      identifier: pick('identifier', params.identifier, null),
      status: pick('status', params.status, null),
      title: pick('title', params.title, null),
      url: pick('url', params.url, null),
    } satisfies LinearWorkVersionSnapshot,
  };
};

export const registerLinearWork = createSnapshotWorkRegister<
  RegisterLinearWorkParams,
  LinearWorkVersionSnapshot
>({
  // Linear update responses can be partial, e.g. { id, state }; keep prior title/url.
  buildSnapshot: linearSnapshot,
  type: 'linear',
});

export const linearWorkAdapter = createSnapshotWorkAdapter<LinearWorkVersionSnapshot>({
  type: 'linear',
});
