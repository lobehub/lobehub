import { type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';

// 全局的 SWR 配置
const swrConfig = {
  provider: () => new Map(),
};

export const withSWR = ({ children }: PropsWithChildren) => (
  <SWRConfig value={swrConfig}>{children}</SWRConfig>
);

interface TestServiceOptions {
  /** 是否检查 async */
  checkAsync?: boolean;
  /** 自定义的额外检查 */
  extraChecks?: (method: string, func: () => any) => void;
  /** 是否跳过某些方法 */
  skipMethods?: string[];
}

const builtinSkipProps = new Set(['userId']);

export const testService = (ServiceClass: new () => any, options: TestServiceOptions = {}) => {
  const { checkAsync = true, skipMethods = ['userId'], extraChecks } = options;

  describe(ServiceClass.name, () => {
    it('should implement all methods as arrow functions', () => {
      const service = new ServiceClass();

      const methods = Object.getOwnPropertyNames(service).filter(
        (method) => !builtinSkipProps.has(method) || !skipMethods.includes(method),
      );

      methods.forEach((method) => {
        const func = service[method];
        // 检查是否为函数
        expect(typeof func).toBe('function');

        const funcString = func.toString();

        // 验证是否是箭头函数
        expect(funcString).toContain('=>');

        // 可选的 async 检查
        if (checkAsync) {
          expect(funcString).toMatch(/^async.*=>/);
        }

        // 运行额外的自定义检查
        if (extraChecks) {
          extraChecks(method, func);
        }
      });
    });
  });
};
