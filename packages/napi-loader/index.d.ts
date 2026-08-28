export interface LoadNativeBindingOptions {
  /** The consuming package's `__dirname`. */
  dirname: string;
  /** The consuming package's name, as published in its package.json. */
  packageName: string;
}

export function loadNativeBinding(options: LoadNativeBindingOptions): unknown;
