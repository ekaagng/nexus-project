import { z } from 'zod';

const optionalEnvString = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().optional()
);
const optionalEnvUrl = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().url().optional()
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  MIGRATION_DATABASE_URL: optionalEnvString,
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  OIDC_ISSUER_URL: optionalEnvUrl,
  OIDC_AUDIENCE: optionalEnvString,
  OIDC_JWKS_URL: optionalEnvUrl,
  OIDC_CLIENT_ID: optionalEnvString,
  OIDC_CLIENT_SECRET: optionalEnvString,
  OIDC_CLIENT_AUTH_METHOD: z.enum(['client_secret_basic', 'client_secret_post', 'none']).default('client_secret_basic'),
  OIDC_REDIRECT_URI: optionalEnvUrl,
  AUTH_FRONTEND_URL: optionalEnvUrl,
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(604800).default(43200),
  SESSION_COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  APP_ENCRYPTION_KEY: optionalEnvString
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
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcClientAuthMethod: 'client_secret_basic' | 'client_secret_post' | 'none';
  oidcRedirectUri?: string;
  authFrontendUrl: string;
  authSessionTtlSeconds: number;
  sessionCookieSecure: boolean;
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

  const loginValues = [value.OIDC_CLIENT_ID, value.OIDC_REDIRECT_URI];
  const loginConfigured = oidcConfigured && loginValues.every(Boolean);
  const loginPartiallyConfigured = loginValues.some(Boolean) && !loginConfigured;
  if (loginPartiallyConfigured) {
    throw new Error('OIDC login requires the complete OIDC settings, OIDC_CLIENT_ID, and OIDC_REDIRECT_URI.');
  }

  if (value.NODE_ENV === 'production' && !loginConfigured) {
    throw new Error('Production requires complete OIDC login configuration, including OIDC_CLIENT_ID and OIDC_REDIRECT_URI.');
  }
  if (value.NODE_ENV === 'production' && !value.APP_ENCRYPTION_KEY) {
    throw new Error('APP_ENCRYPTION_KEY is required in production.');
  }
  if (value.NODE_ENV === 'production' && value.SESSION_COOKIE_SECURE !== 'true') {
    throw new Error('SESSION_COOKIE_SECURE=true is required in production.');
  }

  let encryptionKey: Buffer | undefined;
  if (value.APP_ENCRYPTION_KEY) {
    encryptionKey = Buffer.from(value.APP_ENCRYPTION_KEY, 'base64');
    if (encryptionKey.length !== 32) {
      throw new Error('APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
    }
  }

  const corsOrigins = value.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (corsOrigins.includes('*')) {
    throw new Error('CORS_ORIGINS cannot contain * when credentialed browser sessions are enabled.');
  }
  for (const origin of corsOrigins) {
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error('Each CORS_ORIGINS entry must be an absolute origin.');
    }
    if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) {
      throw new Error('Each CORS_ORIGINS entry must contain only an HTTP(S) origin without a path.');
    }
  }
  const authFrontendUrl = value.AUTH_FRONTEND_URL ?? corsOrigins[0] ?? 'http://localhost:5173';
  let authFrontendOrigin: string;
  try {
    authFrontendOrigin = new URL(authFrontendUrl).origin;
  } catch {
    throw new Error('AUTH_FRONTEND_URL must be a valid absolute URL.');
  }
  if (!corsOrigins.includes(authFrontendOrigin)) {
    throw new Error('AUTH_FRONTEND_URL origin must be included in CORS_ORIGINS.');
  }
  if (value.NODE_ENV === 'production') {
    if (new URL(authFrontendUrl).protocol !== 'https:') {
      throw new Error('AUTH_FRONTEND_URL must use HTTPS in production.');
    }
    if (value.OIDC_REDIRECT_URI && new URL(value.OIDC_REDIRECT_URI).protocol !== 'https:') {
      throw new Error('OIDC_REDIRECT_URI must use HTTPS in production.');
    }
    if (value.OIDC_ISSUER_URL && new URL(value.OIDC_ISSUER_URL).protocol !== 'https:') {
      throw new Error('OIDC_ISSUER_URL must use HTTPS in production.');
    }
    if (value.OIDC_JWKS_URL && new URL(value.OIDC_JWKS_URL).protocol !== 'https:') {
      throw new Error('OIDC_JWKS_URL must use HTTPS in production.');
    }
  }

  return {
    nodeEnv: value.NODE_ENV,
    host: value.API_HOST,
    port: value.API_PORT,
    databaseUrl: value.DATABASE_URL,
    migrationDatabaseUrl: value.MIGRATION_DATABASE_URL || undefined,
    databaseSsl: value.DATABASE_SSL === 'true',
    corsOrigins,
    oidcIssuerUrl: value.OIDC_ISSUER_URL,
    oidcAudience: value.OIDC_AUDIENCE,
    oidcJwksUrl: value.OIDC_JWKS_URL,
    oidcClientId: value.OIDC_CLIENT_ID,
    oidcClientSecret: value.OIDC_CLIENT_SECRET,
    oidcClientAuthMethod: value.OIDC_CLIENT_AUTH_METHOD,
    oidcRedirectUri: value.OIDC_REDIRECT_URI,
    authFrontendUrl,
    authSessionTtlSeconds: value.AUTH_SESSION_TTL_SECONDS,
    sessionCookieSecure: value.SESSION_COOKIE_SECURE === 'true',
    encryptionKey
  };
}
