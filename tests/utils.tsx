import { type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';

// Global SWR configuration
const swrConfig = {
  provider: () => new Map(),
};

export const withSWR = ({ children }: PropsWithChildren) => (
  <SWRConfig value={swrConfig}>{children}</SWRConfig>
);

interface TestServiceOptions {
  /** Whether to check async */
  checkAsync?: boolean;
  /** Custom additional checks */
  extraChecks?: (method: string, func: () => any) => void;
  /** Whether to skip certain methods */
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
        // Check if it's a function
        expect(typeof func).toBe('function');

        const funcString = func.toString();

        // Verify if it's an arrow function
        expect(funcString).toContain('=>');

        // Optional async check
        if (checkAsync) {
          expect(funcString).toMatch(/^async.*=>/);
        }

        // Run additional custom checks
        if (extraChecks) {
          extraChecks(method, func);
        }
      });
    });
  });
};
