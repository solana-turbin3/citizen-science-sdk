import { NextResponse } from 'next/server';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import type { ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Connection, PublicKey } from '@solana/web3.js';
import idl from '../../../lib/idl/photo_verifier.json';
import { createHash } from 'crypto';

// Expected env vars on Vercel
// S3_BUCKET, S3_REGION, S3_PREFIX (e.g., 'photos/'), OPTIONAL: S3_CDN_DOMAIN, TX_INDEX_URL

const BUCKET = process.env.S3_BUCKET || 'photoverifier';
const REGION = process.env.S3_REGION || 'us-east-1';
const PREFIX = normalizePrefix(process.env.S3_PREFIX || 'photos/');
const CDN = process.env.S3_CDN_DOMAIN || null;
const TX_INDEX_URL = process.env.TX_INDEX_URL || null;
const RPC_URL = process.env.RPC_URL || 'https://devnet.helius-rpc.com/?api-key=c7c71360-ee3b-437a-bc8d-0c2931d673df';
const TX_CACHE_TTL_MS = Number(process.env.TX_CACHE_TTL_MS || 5000);

let __txEntriesCache: { ts: number; out: Array<{ hashHex: string; s3Uri: string; location: string; payer: string; signature: string; url: string; timestamp?: string }> } | null = null;

const s3 = new S3Client({ region: REGION });
// Force dynamic execution and disable caching so we always fetch fresh data on refresh
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET() {
  try {
    console.log('list: GET start');
    // Build tx entries directly from RPC on each request
    let txEntries: Array<{ hashHex: string; s3Uri: string; location: string; payer: string; signature: string; url: string; timestamp?: string }> = [];
    try {
      txEntries = await loadTxEntries();
    } catch (e: any) {
      console.error('loadTxEntries error', e);
      txEntries = [];
    }
    console.log('list: loaded tx entries', txEntries.length);

    // List objects under PREFIX. Keys look like: photos/<SEEKER>/<HASH>.jpg
    const listed: string[] = [];
    let token: string | undefined = undefined;
    do {
      const out: ListObjectsV2CommandOutput = await s3.send(
        new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token })
      );
      for (const obj of out.Contents ?? []) {
        if (obj.Key && !obj.Key.endsWith('/') && isPhotoKey(obj.Key)) listed.push(obj.Key);
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);

    // Build responses and try to find optional proof JSON sidecars next to images
    const items = await Promise.all(
      listed.map(async (key) => {
        const { seekerMint, hashHex } = parsePhotoKey(key, PREFIX);
        const url = await buildPublicUrlOrPresigned(BUCKET, key, CDN);
        const proofKey = key.replace(/\.[^.]+$/g, '.json');
        let proof: any = null;
        let proofUrl: string | null = null;
        try {
          const getUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: proofKey }), { expiresIn: 60 });
          const res = await fetch(getUrl);
          if (res.ok) {
            proof = await res.json().catch(() => null);
            proofUrl = getUrl;
          }
        } catch {}

        const match = txEntries?.find((e) => e.hashHex === hashHex) || null;
        const tx = match?.url ?? null;
        const decoded = match
          ? { s3Uri: match.s3Uri, locationString: match.location, payer: match.payer, signature: match.signature, timestamp: match.timestamp }
          : null;
        return {
          key,
          url,
          seekerMint,
          hashHex,
          timestamp: decoded?.timestamp ?? proof?.payload?.timestamp ?? null,
          location: decoded?.locationString ?? proof?.payload?.location ?? null,
          owner: decoded?.payer ?? proof?.payload?.owner ?? null,
          signature: decoded?.signature ?? proof?.signature ?? null,
          proofUrl,
          tx,
          decoded,
        };
      })
    );

    return NextResponse.json({ items, bucket: BUCKET, prefix: PREFIX });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}

async function loadTxEntries(): Promise<Array<{ hashHex: string; s3Uri: string; location: string; payer: string; signature: string; url: string; timestamp?: string }>> {
  if (__txEntriesCache && Date.now() - __txEntriesCache.ts < TX_CACHE_TTL_MS) {
    return __txEntriesCache.out;
  }
  const programIdStr = (idl as any).metadata.address || 'J8U2PEf8ZaXcG5Q7xPCob92qFA8H8LWj1j3xiuKA6QEt';
  const programId = new PublicKey(programIdStr);
  const connection = new Connection(RPC_URL, 'confirmed');
  // console.log('loadTxEntries: using RPC', RPC_URL, 'program', programIdStr);

  // Precompute Anchor instruction discriminator for create_photo_data
  const createIxDisc = createHash('sha256').update('global:create_photo_data').digest().subarray(0, 8);

  const maxSigs = Number(process.env.SIG_LIMIT || process.env.LIMIT || 300);
  const pageSize = 100;
  let fetched: Array<import('@solana/web3.js').ConfirmedSignatureInfo> = [];
  let before: string | undefined = undefined;
  while (fetched.length < maxSigs) {
    const need = Math.min(pageSize, maxSigs - fetched.length);
    const page = await connection.getSignaturesForAddress(programId, { limit: need, before });
    if (!page.length) break;
    fetched.push(...page);
    before = page[page.length - 1]?.signature;
  }
  const sigs = fetched;
  console.log('loadTxEntries: total signatures', sigs.length);
  const out: Array<{ hashHex: string; s3Uri: string; location: string; payer: string; signature: string; url: string; timestamp?: string }>= [];
  for (let i = 0; i < sigs.length; i++) {
    const sig = sigs[i].signature;
    let tx: import('@solana/web3.js').VersionedTransactionResponse | null = null;
    try {
      tx = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
    } catch (e) {
      console.error('getTransaction error for', sig, e);
      continue;
    }
    if (!tx || !tx.transaction) continue;
    const message: any = tx.transaction.message as any;
    const keys = message.staticAccountKeys || message.accountKeys || [];
    const instrs = message.compiledInstructions || message.instructions || [];
    const ix = instrs.find((ci: any) => {
      const progKey = keys[ci.programIdIndex];
      return progKey && progKey.toBase58 && progKey.toBase58() === programId.toBase58();
    });
    if (!ix) continue;
    const dataB64: string = typeof ix.data === 'string' ? ix.data : Buffer.from(ix.data).toString('base64');
    const raw = Buffer.from(dataB64, 'base64');
    // Manually decode Anchor instruction data for create_photo_data
    if (raw.length < 8 || !raw.subarray(0, 8).equals(createIxDisc)) continue;
    let o = 8;
    const hash = raw.subarray(o, o + 32); o += 32;
    const s3Len = raw.readUInt32LE(o); o += 4;
    const s3Uri = raw.subarray(o, o + s3Len).toString('utf8'); o += s3Len;
    const locLen = raw.readUInt32LE(o); o += 4;
    const location = raw.subarray(o, o + locLen).toString('utf8'); o += locLen;
    let timestamp: string | undefined = undefined;
    if (o + 4 <= raw.length) {
      const tsLen = raw.readUInt32LE(o); o += 4;
      if (o + tsLen <= raw.length) {
        timestamp = raw.subarray(o, o + tsLen).toString('utf8');
      }
    }
    const hashHex = Buffer.from(hash).toString('hex');
    const payerIdx = (ix.accounts?.[0] ?? 0) as number;
    const payer = keys[payerIdx]?.toBase58?.() || '';
    const url = `https://solscan.io/tx/${sig}?cluster=devnet`;
    out.push({ hashHex, s3Uri, location, payer, signature: sig, url, timestamp });
  }
  __txEntriesCache = { ts: Date.now(), out };
  return out;
}

function normalizePrefix(p: string): string {
  const trimmed = p.replace(/^\/+|\/+$/g, '');
  return trimmed ? trimmed + '/' : '';
}

function isPhotoKey(key: string): boolean {
  return /\.(jpg|jpeg|png|webp)$/i.test(key);
}

function parsePhotoKey(key: string, basePrefix: string): { seekerMint: string; hashHex: string } {
  const rest = key.replace(new RegExp('^' + escapeRegExp(basePrefix)), '');
  const parts = rest.split('/');
  const seekerMint = parts[0] || 'unknown';
  const file = parts.slice(1).join('/') || '';
  const hashHex = file.split('.')[0] || 'unknown';
  return { seekerMint, hashHex };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function buildPublicUrlOrPresigned(bucket: string, key: string, cdnDomain: string | null): Promise<string> {
  if (cdnDomain) {
    const path = key.startsWith('/') ? key : '/' + key;
    return `https://${cdnDomain}${path}`;
  }
  // Fallback: presign short expiry URL
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, command, { expiresIn: 60 });
}


