# Authentication

Probe uses a custom OIDC-like flow backed to require Zenon Network (Ed25519) keys and signatures.

## Flow Overview

1. **Challenge Request**: POST to `<issuer>/auth/challenge` with wallet address
2. **Sign Challenge**: Sign the challenge string with wallet's private key
3. **Token Exchange**: POST to `<issuer>/auth/token` with signature and public key
4. **Cache Token**: Store JWT locally for subsequent commands

## OIDC Provider Endpoints

**Live URL:** `https://api.zenon.red`

**Local Development:** `http://localhost:3001` (or next available port)

The backend OIDC provider (`nexus/backend/main.ts`) exposes:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/.well-known/openid-configuration` | GET | OIDC discovery document |
| `/.well-known/jwks.json` | GET | JWT public keys |
| `/auth/challenge` | POST | Request signed challenge |
| `/auth/token` | POST | Exchange signature for JWT |
| `/health` | GET | Server health check |

## Challenge Request

```bash
POST /auth/challenge
Content-Type: application/json

{ "address": "z1qz..." }
```

Response:
```json
{
  "nonce": "uuid-v4",
  "challenge": "Sign to authenticate with <issuer>: <nonce>",
  "expires_at": <unix-timestamp>
}
```

Challenge TTL: 300 seconds (5 minutes).

## Token Exchange

```bash
POST /auth/token
Content-Type: application/json

{
  "address": "z1qz...",
  "public_key": "hex-encoded-32-bytes",
  "signature": "hex-encoded-64-bytes",
  "nonce": "uuid-from-challenge"
}
```

Response:
```json
{
  "access_token": "eyJ...",
  "id_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 2592000,
  "scope": "openid profile"
}
```

Token TTL: 2,592,000 seconds (30 days).

## JWT Claims

The JWT contains:
- `iss`: Issuer URL
- `sub`: Zenon address
- `aud`: `spacetimedb`
- `zenon_address`: Zenon address (custom claim)
- `iat`, `exp`: Timestamps
- `jti`: Unique token ID

## Local Cache

Tokens are cached at `~/.probe/tokens/<wallet-name>.json`:

```json
{
  "token": "eyJ...",
  "expiresAt": "2025-03-20T00:00:00.000Z"
}
```

## CLI Usage

```bash
probe auth my-wallet --save
```

This:
1. Loads wallet `my-wallet` (prompts for password)
2. Calls `/auth/challenge` with wallet address
3. Signs challenge with Zenon's Ed25519 private key
4. Calls `/auth/token` with signature
5. Caches JWT to `~/.probe/tokens/my-wallet.json`

### Check Status

```bash
probe auth status --wallet my-wallet
```

Returns cached token validity and expiration.

### Password Sources

Priority order:
1. `--password-file <path>`: Read password from file
2. `PROBE_WALLET_PASSWORD` environment variable
3. Interactive prompt (requires TTY)

### Non-Interactive Auth

For CI/automation:

```bash
export PROBE_WALLET_PASSWORD="..."
probe auth my-wallet --save
```

## SpacetimeDB Integration

The JWT is passed to SpacetimeDB as a Bearer token. SpacetimeDB validates:
1. JWT signature via JWKS endpoint
2. Token expiration
3. Extracts identity from `sub` claim

Commands requiring authentication call `requireAuth()` in `src/utils/context.ts`, which:
1. Loads cached token
2. Connects to SpacetimeDB with token
3. Rejects on 401/unauthorized

## Error Codes

| Code | Meaning |
|------|---------|
| `invalid_address` | Malformed Zenon address |
| `invalid_public_key` | Public key not 32 bytes hex |
| `address_key_mismatch` | Address doesn't derive from public key |
| `invalid_signature` | Signature verification failed |
| `expired_nonce` | Challenge nonce expired or invalid |
| `rate_limited` | Too many challenge requests |
