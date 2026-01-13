import { parseTRPCPath, tRPCConventionFromPathAndType } from './';

describe('splitRpcPath', () => {
  it('should split path into service and method with url', () => {
    const { method, service } = parseTRPCPath('/trpc/lambda/someService.someMethod');
    expect(method).toBe('someMethod');
    expect(service).toBe('someService');
  });

  it('should split path into service and method without url', () => {
    const { method, service } = parseTRPCPath('someService.someMethod');
    expect(method).toBe('someMethod');
    expect(service).toBe('someService');
  });
});

describe('createBaseAttributes', () => {
  it('should create base attributes with service and method', () => {
    const attributes = tRPCConventionFromPathAndType('someService.someMethod', 'query');
    expect(attributes).toEqual({
      'rpc.system': 'trpc',
      'rpc.trpc.path': 'someService.someMethod',
      'rpc.trpc.type': 'query',
      'rpc.service': 'someService',
      'rpc.method': 'someMethod',
    });
  });

  it('should create base attributes without service', () => {
    const attributes = tRPCConventionFromPathAndType('someMethod', 'mutation');
    expect(attributes).toEqual({
      'rpc.system': 'trpc',
      'rpc.trpc.path': 'someMethod',
      'rpc.trpc.type': 'mutation',
      'rpc.method': 'someMethod',
    });
  });
});
