export enum TRPCAttribute {
  RPC_METHOD = 'rpc.method',
  RPC_SERVICE = 'rpc.service',
  RPC_SYSTEM = 'rpc.system',
  RPC_TRPC_PATH = 'rpc.trpc.path',
  RPC_TRPC_STATUS_CODE = 'rpc.trpc.status_code',
  RPC_TRPC_SUCCESS = 'rpc.trpc.success',
  RPC_TRPC_TYPE = 'rpc.trpc.type',
}

export {
  ATTR_ERROR_TYPE,
  ATTR_EXCEPTION_MESSAGE,
  ATTR_EXCEPTION_STACKTRACE,
  ATTR_EXCEPTION_TYPE,
} from '@opentelemetry/semantic-conventions';
