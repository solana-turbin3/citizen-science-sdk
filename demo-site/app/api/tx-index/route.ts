import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { BorshCoder, Idl } from '@coral-xyz/anchor';
import crypto from 'crypto';
import idl from '../../../lib/idl/photo_verifier.json';

// Returns an array of decoded tx entries and logs them to the server console.
// Shape: [{ hashHex, s3Uri, location, payer, signature, url }]
// Env: RPC_URL (optional), PROGRAM_ID (optional), LIMIT (optional)
export async function GET() {
  try {
    const rpcUrl = process.env.RPC_URL || 'https://devnet.helius-rpc.com/?api-key=c7c71360-ee3b-437a-bc8d-0c2931d673df';
    const programIdStr = process.env.PROGRAM_ID || (idl as any).metadata.address || 'J8U2PEf8ZaXcG5Q7xPCob92qFA8H8LWj1j3xiuKA6QEt';
    const limit = Number(process.env.LIMIT || 100);

    const connection = new Connection(rpcUrl, 'confirmed');
    // console.log('tx-index: Using RPC', rpcUrl);
    const programId = new PublicKey(programIdStr);
    const fixedIdl = { ...(idl as any), types: (idl as any).types ?? [] } as Idl;
    const coder = new BorshCoder(fixedIdl);

    // Fetch recent signatures for the programId
    const sigs = await connection.getSignaturesForAddress(programId, { limit });
    console.log('tx-index: fetched signatures', sigs.length);
    const out: Array<{ hashHex: string; s3Uri: string; location: string; payer: string; signature: string; url: string; timestamp?: string }>= [];

    // Fetch transactions in small batches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < sigs.length; i += batchSize) {
      const chunk = sigs.slice(i, i + batchSize);
      const txs = await connection.getTransactions(
        chunk.map((s) => s.signature),
        { maxSupportedTransactionVersion: 0 }
      );

      for (let j = 0; j < txs.length; j++) {
        const tx = txs[j];
        const sig = chunk[j].signature;
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
        let hashHex = '';
        let s3Uri = '';
        let location = '';
        let timestamp: string | undefined = undefined;
        try {
          const decoded = coder.instruction.decode(raw) as any;
          if (!decoded || decoded.name !== 'createPhotoData') throw new Error('not our ix');
          const arr: number[] = decoded.data.hash as number[];
          hashHex = Buffer.from(Uint8Array.from(arr)).toString('hex');
          s3Uri = String(decoded.data.s3Uri);
          location = String(decoded.data.location);
          if (decoded.data.timestamp) timestamp = String(decoded.data.timestamp);
        } catch {
          // Fallback manual decode using discriminator
          const disc = crypto.createHash('sha256').update('global:create_photo_data').digest().subarray(0, 8);
          if (raw.length < 8 || !raw.subarray(0, 8).equals(disc)) continue;
          let o = 8;
          const hash = raw.subarray(o, o + 32); o += 32;
          const s3Len = raw.readUInt32LE(o); o += 4;
          s3Uri = raw.subarray(o, o + s3Len).toString('utf8'); o += s3Len;
          const locLen = raw.readUInt32LE(o); o += 4;
          location = raw.subarray(o, o + locLen).toString('utf8'); o += locLen;
          if (o + 4 <= raw.length) {
            const tsLen = raw.readUInt32LE(o); o += 4;
            if (o + tsLen <= raw.length) {
              timestamp = raw.subarray(o, o + tsLen).toString('utf8');
            }
          }
          hashHex = Buffer.from(hash).toString('hex');
        }
        const payerIdx = (ix.accounts?.[0] ?? 0) as number;
        const payer = keys[payerIdx]?.toBase58?.() || '';
        const url = `https://solscan.io/tx/${sig}?cluster=devnet`;
        const entry = { hashHex, s3Uri, location, payer, signature: sig, url, timestamp };
        console.log('Decoded tx entry:', entry);
        out.push(entry);
      }
    }

    return NextResponse.json({ entries: out });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}


