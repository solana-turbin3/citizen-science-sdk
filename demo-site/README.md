# Citizen Science – Photo Verifier (Demo Site)

A Next.js app (Vercel-ready) that displays images from S3 grouped by Seeker mint. It shows hash, location, timestamp, and optional proof JSON and transaction link.

## Data layout
- Keys: `photos/<SEEKER_MINT>/<PHOTO_HASH>.jpg`
- Optional sidecar JSON: `photos/<SEEKER_MINT>/<PHOTO_HASH>.json`

JSON example:
```json
{
  "payload": {
    "hash": "<hex>",
    "uri": "s3://...",
    "timestamp": "2025-01-01T00:00:00.000Z",
    "location": { "latitude": 0, "longitude": 0, "accuracy": 10 },
    "owner": "<wallet>",
    "seekerMint": "<mint>"
  },
  "signature": "<base64>"
}
```

## Environment variables
Set in Vercel Project Settings (or `.env.local`).

- `S3_BUCKET` – e.g., `photoverifier`
- `S3_REGION` – e.g., `us-east-1`
- `S3_PREFIX` – default `photos/`
- `S3_CDN_DOMAIN` – optional CloudFront domain (otherwise presigned GET)
- `TX_INDEX_URL` – optional `{ [hashHex]: explorerUrl }` map
- `RPC_URL` – Solana RPC endpoint. Default is `https://api.devnet.solana.com`. Do not commit secrets.

Required AWS permissions for the Vercel runtime identity:
- `s3:ListBucket` on the bucket
- `s3:GetObject` on objects under the prefix

## Local development
```bash
pnpm i
pnpm dev
# open http://localhost:3000
```

## Deploy to Vercel
- Create/import project from `demo-site`
- Configure env vars above
- Configure AWS credentials (OIDC or static keys)
- Deploy
