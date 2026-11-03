export type Primitive = number | string | boolean | undefined | null | any[];
type OptionalKeys<T> = { [P in keyof T]-?: undefined extends T[P] ? P : never }[keyof T];
type OptionalField<T, P extends keyof T, K extends keyof T> = T[P] extends Primitive
  ? T[P]
  : Optional<T[P], keyof T[P] & K>;

export type Optional<T, K extends keyof T> = T extends null | undefined
  ? T
  : Partial<Pick<T, K | OptionalKeys<T>>> &
      { [P in Exclude<keyof T, K | OptionalKeys<T>>]: OptionalField<T, P, K> };
