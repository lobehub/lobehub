export type Primitive = number | string | boolean | undefined | null | any[];
export type Optional<T, K extends keyof T> = { [P in K]?: T[P] } & { [P in Exclude<keyof T, K>]: T[P] extends Primitive ? T[P] : Optional<T[P], keyof T[P] & K> };
