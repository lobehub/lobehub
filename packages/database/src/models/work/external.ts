import type {
  ExternalWorkPatchField,
  ExternalWorkVersionSnapshot,
  RegisterExternalWorkParams,
} from '@lobechat/types';

import { createSnapshotWorkAdapter, createSnapshotWorkRegister } from './snapshotWork';

export const externalSnapshot = (
  params: RegisterExternalWorkParams,
  previous?: ExternalWorkVersionSnapshot | null,
): { external: ExternalWorkVersionSnapshot } => {
  const patchFields = new Set(params.patchFields ?? []);
  // Update responses can be partial (e.g. Linear `{ id, state }`, a GitHub merge
  // result); keep prior fields for anything not named in `patchFields`.
  const pick = <T>(field: ExternalWorkPatchField, value: T | null | undefined, fallback: T) =>
    patchFields.has(field)
      ? (value ?? fallback)
      : ((previous?.[field] as T | undefined) ?? fallback);

  return {
    external: {
      description: pick('description', params.description, null),
      identifier: pick('identifier', params.identifier, null),
      status: pick('status', params.status, null),
      title: pick('title', params.title, null),
      url: pick('url', params.url, null),
    } satisfies ExternalWorkVersionSnapshot,
  };
};

export const registerExternalWork = createSnapshotWorkRegister<
  RegisterExternalWorkParams,
  ExternalWorkVersionSnapshot
>({
  buildSnapshot: externalSnapshot,
  type: 'external',
});

export const externalWorkAdapter = createSnapshotWorkAdapter<ExternalWorkVersionSnapshot>({
  type: 'external',
});
