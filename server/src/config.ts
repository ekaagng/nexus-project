import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  MIGRATION_DATABASE_URL: z.string().optional(),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  OIDC_ISSUER_URL: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().min(1).optional(),
  OIDC_JWKS_URL: z.string().url().optional(),
  APP_ENCRYPTION_KEY: z.string().optional()
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  migrationDatabaseUrl?: string;
  databaseSsl: boolean;
  corsOrigins: string[];
  oidcIssuerUrl?: string;
  oidcAudience?: string;
  oidcJwksUrl?: string;
  encryptionKey?: Buffer;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Invalid server configuration: ${details}`);
  }

  const value = parsed.data;
  const oidcValues = [value.OIDC_ISSUER_URL, value.OIDC_AUDIENCE, value.OIDC_JWKS_URL];
  const oidcConfigured = oidcValues.every(Boolean);
  const oidcPartiallyConfigured = oidcValues.some(Boolean) && !oidcConfigured;

  if (oidcPartiallyConfigured) {
    throw new Error('OIDC_ISSUER_URL, OIDC_AUDIENCE, and OIDC_JWKS_URL must be configured together.');
  }
  if (value.NODE_ENV === 'production' && !oidcConfigured) {
    throw new Error('OIDC settings are required in production.');
  }
  if (value.NODE_ENV === 'production' && !value.APP_ENCRYPTION_KEY) {
    throw new Error('APP_ENCRYPTION_KEY is required in production.');
  }

  let encryptionKey: Buffer | undefined;
  if (value.APP_ENCRYPTION_KEY) {
    encryptionKey = Buffer.from(value.APP_ENCRYPTION_KEY, 'base64');
    if (encryptionKey.length !== 32) {
      throw new Error('APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
    }
  }

  return {
    nodeEnv: value.NODE_ENV,
    host: value.API_HOST,
    port: value.API_PORT,
    databaseUrl: value.DATABASE_URL,
    migrationDatabaseUrl: value.MIGRATION_DATABASE_URL || undefined,
    databaseSsl: value.DATABASE_SSL === 'true',
    corsOrigins: value.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    oidcIssuerUrl: value.OIDC_ISSUER_URL,
    oidcAudience: value.OIDC_AUDIENCE,
    oidcJwksUrl: value.OIDC_JWKS_URL,
    encryptionKey
  };
}
