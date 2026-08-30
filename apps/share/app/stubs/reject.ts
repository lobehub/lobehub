export const reject = (name: string): never =>
  new Proxy(() => {}, {
    apply() {
      throw new Error(`${name} is not available during SSR`);
    },
    get(_target, prop) {
      if (prop === Symbol.toPrimitive || prop === 'then') return undefined;
      return reject(`${name}.${String(prop)}`);
    },
  }) as never;
