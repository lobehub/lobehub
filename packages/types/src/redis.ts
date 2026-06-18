export type RedisConfig = {
  database?: number;
  enabled: boolean;
  password?: string;
  prefix: string;
  tls: boolean;
  url: string;
  username?: string;
};
