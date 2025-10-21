# Citizen Science SDK

A monorepo for building verifiable photo capture and browsing experiences. In a world of AI‑generated content, we need trustworthy proofs that a photo was actually taken by a real device at a real time and place. This project provides:

- An SDK for capturing photos with signed, tamper‑evident metadata
- A mobile test app to exercise the flow end‑to‑end
- A simple on‑chain program to anchor proofs on Solana
- Infra to safely upload to S3 via presigned URLs
- A demo site to browse verified photos and their proofs

## Motivation
AI makes it trivial to fabricate convincing images. For climate science, journalism, and public infrastructure monitoring, we need a way to attest that images are authentic: captured by a device, at a time and location, with an auditable trail. This repo is a starting point for capturing, storing, and verifying photo evidence with cryptographic signatures and optional on‑chain anchoring.

## Repository layout
- `packages/photoverifier-sdk/` — TypeScript SDK used by apps to produce signed payloads and manage uploads.
- `photo-verifier/` — Expo/React Native test app that captures photos, signs payloads, and uploads.
- `on-chain/photo-verifier/` — Anchor workspace for the Solana program that verifies/anchors photo proofs.
- `infra/` — CloudFormation template and scripts to deploy a minimal presign API and S3 CORS.
- `demo-site/` — Next.js app to browse photos in S3, view proofs, and link to transactions.

## Prerequisites
- Node 18+ and a package manager (yarn, pnpm, or npm)
- For mobile: Expo tooling and native build env (Android Studio and/or Xcode)
  - Expo setup guide: https://docs.expo.dev/get-started/set-up-your-environment/?mode=development-build&buildEnv=local
- For infra: AWS CLI configured with credentials and a target S3 bucket
- For on‑chain: Solana toolchain and Anchor CLI

## Quick start by component

### SDK — `packages/photoverifier-sdk`
Build the SDK so local consumers can link it.

```bash
cd packages/photoverifier-sdk
yarn install
yarn build
# outputs to dist/
```

Notes:
- This package lists peer dependencies (e.g., Expo, React Native, Solana libs). Install them in your app.

### Mobile test app — `photo-verifier`
Run the Expo app on device/emulator.

```bash
cd photo-verifier
yarn install
yarn dev            # starts Metro
yarn android        # or: yarn ios
```

Tip: If you haven’t prebuilt native projects yet, `yarn android`/`yarn ios` will run `expo run:*` which generates native projects on first run.

### Demo site — `demo-site`
Next.js app that reads from S3 and shows photos grouped by Seeker mint, with proof metadata.

```bash
cd demo-site
yarn install        # or pnpm i
yarn dev            # http://localhost:3000
```

Configure these environment variables (e.g., `.env.local` or Vercel project settings):
- `S3_BUCKET` — e.g., `photoverifier`
- `S3_REGION` — e.g., `us-east-1`
- `S3_PREFIX` — e.g., `photos/`
- `S3_CDN_DOMAIN` — optional CloudFront domain; if unset the app presigns GET
- `TX_INDEX_URL` — optional map `{ [hashHex]: explorerUrl }`
- `RPC_URL` — Solana RPC (defaults to Devnet)

Required AWS permissions for the runtime identity:
- `s3:ListBucket` on the bucket
- `s3:GetObject` on the `S3_PREFIX`

### Infra — `infra`
Deploy a minimal presign API (HTTP API Gateway + Lambda) and set S3 CORS.

```bash
cd infra
# Create or choose an S3 bucket first, e.g. "photoverifier"
./deploy.sh <stack-name> <bucket-name> [allowed-origin]
# Example:
./deploy.sh photoverifier-presign photoverifier http://localhost:3000
# The script will print the API endpoint and /uploads path.
```

What it does:
- Applies `s3-cors.json` to your bucket
- Deploys `presign-api.yaml` CloudFormation stack
- Returns `POST /uploads` endpoint that issues presigned S3 PUT URLs

You can smoke‑test the endpoint with `infra/test-presign.sh` (edit vars inside or use `curl`).

### On‑chain program — `on-chain/photo-verifier`
Anchor workspace for Solana program logic (verification/anchoring of photo proofs).

```bash
cd on-chain/photo-verifier
# Ensure Solana and Anchor are installed
anchor build
anchor test
```

## How the pieces fit together
1. The mobile app uses the SDK to capture a photo, collect signed metadata (hash, timestamp, location, wallet), and request a presigned URL from the presign API.
2. The app uploads the photo (and optional JSON sidecar) directly to S3 using the presigned URL.
3. The on‑chain program can be invoked to anchor or verify proof data on Solana (optional, depending on your flow).
4. The demo site reads from S3 and displays photos with their proof metadata and links to blockchain transactions when available.

## Roadmap
- Stronger device attestations
- Additional storage backends and CDNs
- Richer on‑chain verification flows and indexing

## Contributing
Issues and PRs welcome. Please open an issue to discuss significant changes.
