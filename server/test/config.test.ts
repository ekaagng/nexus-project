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
  APP_ENCRYPTION_KEY: ''
};

test('blank optional OIDC settings are treated as unconfigured', () => {
  const config = loadConfig(baseEnv);
  assert.equal(config.oidcIssuerUrl, undefined);
  assert.equal(config.oidcAudience, undefined);
  assert.equal(config.oidcJwksUrl, undefined);
  assert.equal(config.encryptionKey, undefined);
});

test('partial OIDC configuration is rejected', () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, OIDC_ISSUER_URL: 'https://identity.example.com' }),
    /must be configured together/
  );
});

test('production configuration requires OIDC and an encryption key', () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, NODE_ENV: 'production' }),
    /OIDC settings are required in production/
  );
  const key = Buffer.alloc(32, 4).toString('base64');
  const configured = loadConfig({
    ...baseEnv,
    NODE_ENV: 'production',
    OIDC_ISSUER_URL: 'https://identity.example.com',
    OIDC_AUDIENCE: 'nexus-api',
    OIDC_JWKS_URL: 'https://identity.example.com/.well-known/jwks.json',
    APP_ENCRYPTION_KEY: key
  });
  assert.equal(configured.encryptionKey?.length, 32);
});
