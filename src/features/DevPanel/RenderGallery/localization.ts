import { type TFunction } from 'i18next';

interface RenderGalleryApiMeta {
  apiName: string;
  description?: string;
  identifier: string;
}

interface RenderGalleryToolsetMeta {
  identifier: string;
  toolsetDescription?: string;
  toolsetName: string;
}

export const localizeRenderGalleryApi = <T extends RenderGalleryApiMeta>(
  api: T,
  t: TFunction<'plugin'>,
) => ({
  ...api,
  apiDisplayName: t(`builtins.${api.identifier}.apiName.${api.apiName}`, {
    defaultValue: api.apiName,
  }),
  description: api.description
    ? t(`builtins.${api.identifier}.apiDescription.${api.apiName}`, {
        defaultValue: api.description,
      })
    : undefined,
});

export const localizeRenderGalleryToolset = <T extends RenderGalleryToolsetMeta>(
  toolset: T,
  t: TFunction<'plugin'>,
) => ({
  ...toolset,
  toolsetDescription: toolset.toolsetDescription
    ? t(`builtins.${toolset.identifier}.description`, {
        defaultValue: toolset.toolsetDescription,
      })
    : undefined,
  toolsetName: t(`builtins.${toolset.identifier}.title`, {
    defaultValue: toolset.toolsetName,
  }),
});
