// Bundle-size import boundaries for src/**, shared by eslint.config.mjs. These
// keep real import() seams in place instead of relying on component-level
// conditional rendering.

// Shared by every src/** no-restricted-imports block: flat config replaces a
// rule per file instead of merging it, so a scoped override would otherwise
// drop these.
export const performanceRestrictedImportPaths = [
  {
    allowTypeImports: true,
    importNames: ['ModelIcon', 'ModelTag', 'ProviderCombine', 'ProviderIcon'],
    message:
      'These features statically import every brand icon (~3 MB). Import them from "@/components/LobeIcons", which mounts them through lazy().',
    name: '@lobehub/icons',
  },
  {
    allowTypeImports: true,
    message:
      'Import ProviderIcon / ProviderCombine from "@/components/LobeIcons", which mounts them through lazy().',
    name: '@/libs/providerIcon',
  },
  {
    allowTypeImports: true,
    importNames: ['EmojiPicker'],
    message:
      'EmojiPicker carries the emoji-mart dataset. Use "@/components/EmojiPicker", which mounts it through lazy().',
    name: '@lobehub/ui',
  },
  {
    message:
      'Import the imperative facade from "@/features/ShareModal" so the modal implementation stays outside initial chunks.',
    name: '@/features/ShareModal/Modal',
  },
  {
    allowTypeImports: true,
    importNames: ['motion', 'm'],
    message:
      'The app runs under <LazyMotion features={domMax}>; `motion` bundles every feature again and `m` from the barrel drags it along. Use `import * as m from "motion/react-m"`.',
    name: 'motion/react',
  },
  {
    allowTypeImports: true,
    message:
      'Do not import the model-bank root barrel; it re-exports the full aiModels catalog (1.4 MB raw). Use a subpath such as "model-bank/aiModel", "model-bank/modelProvider", "model-bank/standardParameters" or "model-bank/utils".',
    name: 'model-bank',
  },
];

// Relative imports inside a feature never match a `paths` name, so the modal
// seams that features reach through relative paths are guarded by pattern.
export const performanceRestrictedImportPatterns = [
  {
    message:
      'Import the facade from "ShareMessageModal" (openShareMessageModal), which loads the modal with its screenshot and PDF libraries on click.',
    regex: String.raw`(^|/)ShareMessageModal/Modal$`,
  },
];

// Bundle boundary for browser code: these entries work there but drag a large
// graph into every chunk that reaches them. Server-side trees opt out with
// `serverSide: true`, where the full runtime is the point.
export const browserBundleRestrictedImportPaths = [
  {
    allowTypeImports: true,
    message:
      'The @lobechat/model-runtime root re-exports every provider with its SDK (~420 KB gzipped on the share page). Import a subpath such as "@lobechat/model-runtime/errors", and enums like AgentRuntimeErrorType from "@lobechat/types".',
    name: '@lobechat/model-runtime',
  },
];
