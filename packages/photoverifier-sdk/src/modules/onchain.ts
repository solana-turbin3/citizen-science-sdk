import { PublicKey, SystemProgram, Transaction, TransactionInstruction, Connection, Keypair, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha256';
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import { buildS3KeyForPhoto, buildS3Uri, putToPresignedUrl, S3Config } from './storage';

// Program constants
export const PHOTO_VERIFIER_PROGRAM_ID = new PublicKey('J8U2PEf8ZaXcG5Q7xPCob92qFA8H8LWj1j3xiuKA6QEt');

// PDA seeds: ["photo", payer, hash, timestamp]
export function derivePhotoDataPda(payer: PublicKey, hash32: Uint8Array, timestamp: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('photo'), payer.toBuffer(), Buffer.from(hash32), Buffer.from(new TextEncoder().encode(timestamp))],
    PHOTO_VERIFIER_PROGRAM_ID,
  );
}

// Anchor instruction discriminator: sha256('global:' + 'createPhotoData').slice(0, 8)
function getCreatePhotoDataDiscriminator(): Uint8Array {
  const enc = new TextEncoder();
  // Anchor uses the Rust function name (snake_case) in the discriminator preimage
  const preimage = enc.encode('global:create_photo_data');
  const digest = sha256(preimage);
  return digest.slice(0, 8);
}

function u32le(len: number): Uint8Array {
  const v = new Uint8Array(4);
  v[0] = len & 0xff;
  v[1] = (len >>> 8) & 0xff;
  v[2] = (len >>> 16) & 0xff;
  v[3] = (len >>> 24) & 0xff;
  return v;
}

function encodeCreatePhotoDataArgs(args: { hash32: Uint8Array; s3Uri: string; location: string; timestamp: string }): Uint8Array {
  if (args.hash32.length !== 32) throw new Error('hash32 must be 32 bytes');
  const enc = new TextEncoder();
  const s3Bytes = enc.encode(args.s3Uri);
  const locBytes = enc.encode(args.location);
  const tsBytes = enc.encode(args.timestamp);
  const disc = getCreatePhotoDataDiscriminator();
  const totalLen = 8 + 32 + 4 + s3Bytes.length + 4 + locBytes.length + 4 + tsBytes.length;
  const out = new Uint8Array(totalLen);
  let o = 0;
  out.set(disc, o); o += 8;
  out.set(args.hash32, o); o += 32;
  out.set(u32le(s3Bytes.length), o); o += 4;
  out.set(s3Bytes, o); o += s3Bytes.length;
  out.set(u32le(locBytes.length), o); o += 4;
  out.set(locBytes, o); o += locBytes.length;
  out.set(u32le(tsBytes.length), o); o += 4;
  out.set(tsBytes, o); o += tsBytes.length;
  return out;
}

export function buildCreatePhotoDataInstruction(params: {
  payer: PublicKey;
  hash32: Uint8Array;
  s3Uri: string;
  location: string;
  timestamp: string;
}): { instruction: TransactionInstruction; photoDataPda: PublicKey } {
  const { payer, hash32, s3Uri, location, timestamp } = params;
  const [photoDataPda] = derivePhotoDataPda(payer, hash32, timestamp);
  const data = encodeCreatePhotoDataArgs({ hash32, s3Uri, location, timestamp });
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: photoDataPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return {
    instruction: new TransactionInstruction({ programId: PHOTO_VERIFIER_PROGRAM_ID, keys, data: Buffer.from(data) }),
    photoDataPda,
  };
}

export async function buildCreatePhotoDataTransaction(params: {
  connection: Connection;
  payer: PublicKey;
  hash32: Uint8Array;
  s3Uri: string;
  location: string;
  timestamp: string;
}): Promise<{ transaction: VersionedTransaction; photoDataPda: PublicKey }> {
  const { payer, hash32, s3Uri, location, timestamp, connection } = params;
  const { instruction, photoDataPda } = buildCreatePhotoDataInstruction({ payer, hash32, s3Uri, location, timestamp });
  const { blockhash } = await connection.getLatestBlockhash();
  const computeIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
  ];
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [...computeIxs, instruction],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  return { transaction: tx, photoDataPda };
}

export async function sendTransactionWithKeypair(connection: Connection, tx: Transaction, signer: Keypair): Promise<string> {
  tx.partialSign(signer);
  return connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
}

export async function confirmTransaction(connection: Connection, signature: string): Promise<void> {
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
}

export async function hashBytes(bytes: Uint8Array): Promise<{ hash32: Uint8Array; hashHex: string }> {
  const digest = blake3(bytes);
  return { hash32: digest, hashHex: bytesToHex(digest) };
}

export async function uploadAndSubmit(params: {
  connection: Connection;
  payer: PublicKey;
  sendTransaction: (tx: Transaction | VersionedTransaction) => Promise<string>; // wallet-provided sender
  s3: S3Config;
  bucket: string;
  seekerMint: string;
  basePrefix?: string;
  photoBytes: Uint8Array;
  locationString: string;
  contentType?: string;
  timestamp: string;
}): Promise<{
  signature: string;
  photoDataPda: PublicKey;
  s3Key: string;
  s3Uri: string;
  hashHex: string;
}>{
  const { connection, payer, sendTransaction, s3, bucket, seekerMint, basePrefix, photoBytes, locationString, timestamp } = params;
  const { hash32, hashHex } = await hashBytes(photoBytes);
  const s3Key = buildS3KeyForPhoto({ seekerMint, photoHashHex: hashHex, basePrefix });
  const s3Uri = buildS3Uri(bucket, s3Key);

  await putToPresignedUrl({
    url: (await s3.upload({ key: s3Key, contentType: params.contentType || 'image/jpeg', bytes: photoBytes })).url,
    bytes: photoBytes,
    contentType: params.contentType || 'image/jpeg',
  });

  const { transaction, photoDataPda } = await buildCreatePhotoDataTransaction({
    connection,
    payer,
    hash32,
    s3Uri,
    location: locationString,
    timestamp,
  });

  const signature = await sendTransaction(transaction);
  await confirmTransaction(connection, signature);
  return { signature, photoDataPda, s3Key, s3Uri, hashHex };
}


