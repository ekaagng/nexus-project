import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const baseEnv = {
  DATABASE_URL: 'postgresql://nexus_app:local-only@localhost:5432/nexus',
  MIGRATION_DATABASE_URL: 'postgresql://nexus_migrator:local-only@localhost:5432/nexus',
  NODE_ENV: 'development',
  OIDC_ISSUER_URL: '',
  OIDC_AUDIENCE: '',
  OIDC_JWKS_URL: '',
  OIDC_CLIENT_ID: '',
  OIDC_CLIENT_SECRET: '',
  OIDC_REDIRECT_URI: '',
  AUTH_FRONTEND_URL: 'http://localhost:5173',
  CORS_ORIGINS: 'http://localhost:5173',
  SESSION_COOKIE_SECURE: 'false',
  APP_ENCRYPTION_KEY: ''
};

test('blank optional OIDC settings are treated as unconfigured', () => {
  const config = loadConfig(baseEnv);
  assert.equal(config.oidcIssuerUrl, undefined);
  assert.equal(config.oidcAudience, undefined);
  assert.equal(config.oidcJwksUrl, undefined);
  assert.equal(config.oidcClientId, undefined);
  assert.equal(config.oidcRedirectUri, undefined);
  assert.equal(config.encryptionKey, undefined);
  assert.equal(config.authFrontendUrl, 'http://localhost:5173');
});

test('partial OIDC API configuration is rejected', () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, OIDC_ISSUER_URL: 'https://identity.example.com' }),
    /must be configured together/
  );
});

test('partial browser login configuration is rejected', () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, OIDC_CLIENT_ID: 'nexus-web' }),
    /OIDC login requires the complete OIDC settings/
  );
});

test('frontend origin must be explicitly allowed by CORS', () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, AUTH_FRONTEND_URL: 'http://localhost:4173' }),
    /origin must be included in CORS_ORIGINS/
  );
});

test('production configuration requires OIDC login, encryption and secure cookies', () => {
  const key = Buffer.alloc(32, 4).toString('base64');
  const productionEnv = {
    ...baseEnv,
    NODE_ENV: 'production',
    OIDC_ISSUER_URL: 'https://identity.example.com',
    OIDC_AUDIENCE: 'nexus-api',
    OIDC_JWKS_URL: 'https://identity.example.com/.well-known/jwks.json',
    OIDC_CLIENT_ID: 'nexus-web',
    OIDC_CLIENT_SECRET: 'client-secret',
    OIDC_REDIRECT_URI: 'https://api.example.com/api/v1/auth/oidc/callback',
    AUTH_FRONTEND_URL: 'https://app.example.com',
    CORS_ORIGINS: 'https://app.example.com',
    SESSION_COOKIE_SECURE: 'true',
    APP_ENCRYPTION_KEY: key
  };

  const configured = loadConfig(productionEnv);
  assert.equal(configured.encryptionKey?.length, 32);
  assert.equal(configured.sessionCookieSecure, true);
  assert.equal(configured.oidcClientId, 'nexus-web');

  assert.throws(
    () => loadConfig({ ...productionEnv, SESSION_COOKIE_SECURE: 'false' }),
    /SESSION_COOKIE_SECURE=true is required/
  );
});

test('production rejects non-HTTPS frontend and callback URLs', () => {
  const key = Buffer.alloc(32, 4).toString('base64');
  const productionEnv = {
    ...baseEnv,
    NODE_ENV: 'production',
    OIDC_ISSUER_URL: 'https://identity.example.com',
    OIDC_AUDIENCE: 'nexus-api',
    OIDC_JWKS_URL: 'https://identity.example.com/.well-known/jwks.json',
    OIDC_CLIENT_ID: 'nexus-web',
    OIDC_CLIENT_SECRET: 'client-secret',
    OIDC_REDIRECT_URI: 'http://api.example.com/api/v1/auth/oidc/callback',
    AUTH_FRONTEND_URL: 'https://app.example.com',
    CORS_ORIGINS: 'https://app.example.com',
    SESSION_COOKIE_SECURE: 'true',
    APP_ENCRYPTION_KEY: key
  };

  assert.throws(() => loadConfig(productionEnv), /OIDC_REDIRECT_URI must use HTTPS/);
});

test('credentialed browser sessions reject wildcard CORS origins', () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, CORS_ORIGINS: '*', AUTH_FRONTEND_URL: 'http://localhost:5173' }),
    /cannot contain \*/
  );
});

test('browser login fails fast when its encryption key or confidential-client secret is missing', () => {
  const oidcEnv = {
    ...baseEnv,
    OIDC_ISSUER_URL: 'https://identity.example.com',
    OIDC_AUDIENCE: 'nexus-api',
    OIDC_JWKS_URL: 'https://identity.example.com/.well-known/jwks.json',
    OIDC_CLIENT_ID: 'nexus-web',
    OIDC_REDIRECT_URI: 'http://localhost:8787/api/v1/auth/oidc/callback'
  };

  assert.throws(() => loadConfig(oidcEnv), /APP_ENCRYPTION_KEY is required/);

  const key = Buffer.alloc(32, 4).toString('base64');
  assert.throws(
    () => loadConfig({ ...oidcEnv, APP_ENCRYPTION_KEY: key }),
    /OIDC_CLIENT_SECRET is required/
  );
});
