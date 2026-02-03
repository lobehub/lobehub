/**
 * 将多个 action 对象(通常是 class 实例)扁平化为一个普通对象
 *
 * 解决 class 实例无法通过 spread 操作符正确复制 prototype 方法的问题
 * 通过反射遍历 prototype chain,提取所有 public methods 并绑定 this 上下文
 *
 * @param actions - action 对象数组(通常是 class 实例)
 * @returns 包含所有 action 方法的普通对象
 *
 * @example
 * ```ts
 * const store = {
 *   ...initialState,
 *   ...flattenActions([slice1(...params), slice2(...params)]),
 * };
 * ```
 */
export const flattenActions = <T extends object>(actions: object[]): T => {
  const result = {} as T;

  for (const action of actions) {
    // 遍历 prototype chain 获取所有方法
    let current: object | null = action;
    while (current && current !== Object.prototype) {
      const keys = Object.getOwnPropertyNames(current);

      for (const key of keys) {
        if (key === 'constructor') continue;
        if (key in result) continue; // 跳过已存在的属性(优先使用第一个 action 的方法)

        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor) continue;

        if (typeof descriptor.value === 'function') {
          // 方法: 绑定 this 上下文到原始 action 实例
          (result as any)[key] = descriptor.value.bind(action);
        } else {
          // 非函数属性: 直接复制描述符
          Object.defineProperty(result, key, {
            ...descriptor,
            configurable: true,
            enumerable: true,
          });
        }
      }

      current = Object.getPrototypeOf(current);
    }
  }

  return result;
};
