/**
 * Validation of a widget version's authored content, shared by every entry
 * point that records a draft so all accept exactly the same content. The
 * rules live in the public `@lobechat/widget-spec` package, which presets,
 * the REST API and third-party authoring tools share.
 */
export {
  widgetManifestSchema,
  widgetVersionContentSchema,
  widgetViewSchema,
} from '@lobechat/widget-spec';
