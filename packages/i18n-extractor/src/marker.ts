export const DEFAULT_NAMESPACE_MARKER = '__i18nNamespace';

export interface NamespaceMarker<N extends string> {
  readonly __i18nNamespace?: N;
}

export type Namespaced<N extends string, F> = F & NamespaceMarker<N>;

export type NamespacedTranslate<
  N extends string,
  Result = string,
  Options = Record<string, unknown>,
> = Namespaced<N, (key: string, options?: Options) => Result>;
