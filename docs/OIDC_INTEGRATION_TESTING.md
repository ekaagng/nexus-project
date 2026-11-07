# OIDC browser-login integration tests

Run the local OIDC integration suite with:

```bash
npm run test:server
```

The suite boots a local HTTP OpenID Provider with a generated RSA signing key and serves:

- `/.well-known/openid-configuration`
- `/authorize`
- `/token`
- `/jwks`

The application under test is the real Fastify app built by `buildApp()`. It performs real HTTP discovery and token exchange against the mock provider, validates a signed ID token against the provider's JWKS, and exercises the real auth/session routes. PostgreSQL is replaced by a deterministic in-memory test double that models only the SQL used by the authentication routes; this keeps the tests isolated and does not require a developer database.

## Covered behavior

1. OIDC readiness endpoint and discovery.
2. Authorization Code redirect with state, nonce, and PKCE S256 challenge.
3. PKCE verifier exchange and signature validation against JWKS.
4. Successful callback, normalized identity, opaque session creation, and session lookup.
5. Session-cookie attributes and hash-only session persistence.
6. CSRF Origin rejection, logout, cookie clearing, and post-logout session rejection.
7. State-cookie mismatch rejected before token exchange.
8. Wrong nonce, wrong audience, and expired ID tokens rejected without creating a session.
9. PKCE challenge mismatch rejected by the mock token endpoint.
10. Login transaction replay rejected; callback cannot create a second session.

## What this does not prove

This suite verifies the NEXUS OIDC protocol implementation against a controlled local provider. It does not validate a real provider's tenant/client configuration, consent screen, MFA/conditional-access policy, production DNS/TLS/reverse-proxy behavior, browser cookie policy across deployed domains, or the provider's operational availability. Those require a separate staging run after selecting and configuring the production Identity Provider.
