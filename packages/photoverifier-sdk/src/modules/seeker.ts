import type { Connection, PublicKey } from '@solana/web3.js';
import { Platform } from 'react-native';
import { Connection as Web3Connection, PublicKey as Web3PublicKey } from '@solana/web3.js';

export async function findSeekerMintForOwner(
  connection: Connection,
  owner: PublicKey,
  seekerMintsByCluster: string[],
): Promise<string | null> {
  try {
    if (!seekerMintsByCluster?.length) return null;
    const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await import('@solana/spl-token');
    const [tokenAccounts, token2022Accounts] = await Promise.all([
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
    ]);
    const all = [...tokenAccounts.value, ...token2022Accounts.value];
    for (const acc of all) {
      const parsed: any = acc.account.data;
      const mint: string | undefined = parsed?.parsed?.info?.mint;
      const amount: string | undefined = parsed?.parsed?.info?.tokenAmount?.amount;
      if (mint && amount !== '0' && seekerMintsByCluster.includes(mint)) return mint;
    }
  } catch {}
  return null;
}

export type SeekerDetectionResult = {
  isSeeker: boolean;
  seekerMint: string | null;
};

// High-level helper wrapping the Seeker Genesis Token verification (client-side half):
//  - Verifies wallet holds one of the configured Seeker Genesis Token mint addresses
//  - Returns the matching mint if found
export async function detectSeekerUser(
  connection: Connection,
  owner: PublicKey,
  seekerMintsByCluster: string[],
): Promise<SeekerDetectionResult> {
  const mint = await findSeekerMintForOwner(connection, owner, seekerMintsByCluster);
  return { isSeeker: !!mint, seekerMint: mint };
}

// Lightweight client-side device check using Platform constants. Spoofable; for UX only.
export function isSeekerDevice(): boolean {
  try {
    return (Platform as any)?.constants?.Model === 'Seeker';
  } catch {
    return false;
  }
}

// Client-side verification of Seeker Genesis Token using Helius getTokenAccountsByOwnerV2
export async function verifySeekerWithHelius(params: {
  walletAddress: string;
  heliusApiKey: string;
}): Promise<{ isVerified: boolean; mint: string | null }> {
  const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${params.heliusApiKey}`;
  // Constants from docs
  const SGT_MINT_AUTHORITY = 'GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4';
  const SGT_METADATA_ADDRESS = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te';
  const SGT_GROUP_MINT_ADDRESS = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te';

  try {
    const connection = new Web3Connection(HELIUS_RPC_URL);

    let allTokenAccounts: any[] = [];
    let paginationKey: any = null;
    let pageCount = 0;
    do {
      pageCount++;
      const requestPayload = {
        jsonrpc: '2.0',
        id: `page-${pageCount}`,
        method: 'getTokenAccountsByOwnerV2',
        params: [
          params.walletAddress,
          { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
          { encoding: 'jsonParsed', limit: 1000, ...(paginationKey ? { paginationKey } : {}) },
        ],
      } as const;

      const resp = await fetch(HELIUS_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if ((data as any).error) throw new Error(`RPC: ${(data as any).error?.message}`);
      const value = (data as any)?.result?.value?.accounts ?? [];
      if (value.length) allTokenAccounts.push(...value);
      paginationKey = (data as any)?.result?.paginationKey ?? null;
    } while (paginationKey);

    if (!allTokenAccounts.length) return { isVerified: false, mint: null };

    const mintPubkeys = allTokenAccounts
      .map((acc) => {
        try {
          const mintStr = acc?.account?.data?.parsed?.info?.mint;
          return mintStr ? new Web3PublicKey(mintStr) : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Web3PublicKey[];

    const BATCH_SIZE = 100;
    const mintAccountInfos: (import('@solana/web3.js').AccountInfo<Buffer> | null)[] = [];
    for (let i = 0; i < mintPubkeys.length; i += BATCH_SIZE) {
      const batch = mintPubkeys.slice(i, i + BATCH_SIZE);
      const infos = await connection.getMultipleAccountsInfo(batch);
      mintAccountInfos.push(...infos);
    }

    const spl = await import('@solana/spl-token');
    const { unpackMint, getMetadataPointerState, getTokenGroupMemberState, TOKEN_2022_PROGRAM_ID } = spl as any;

    for (let i = 0; i < mintAccountInfos.length; i++) {
      const mintInfo = mintAccountInfos[i];
      if (!mintInfo) continue;
      const mintPubkey = mintPubkeys[i];
      try {
        const mint = unpackMint(mintPubkey, mintInfo, TOKEN_2022_PROGRAM_ID);
        const mintAuthority = mint.mintAuthority?.toBase58();
        const hasCorrectMintAuthority = mintAuthority === SGT_MINT_AUTHORITY;
        const metadataPointer = getMetadataPointerState(mint);
        const hasCorrectMetadata =
          metadataPointer &&
          metadataPointer.authority?.toBase58() === SGT_MINT_AUTHORITY &&
          metadataPointer.metadataAddress?.toBase58() === SGT_METADATA_ADDRESS;
        const tokenGroupMemberState = getTokenGroupMemberState(mint);
        const hasCorrectGroupMember =
          tokenGroupMemberState && tokenGroupMemberState.group?.toBase58() === SGT_GROUP_MINT_ADDRESS;
        if (hasCorrectMintAuthority && hasCorrectMetadata && hasCorrectGroupMember) {
          return { isVerified: true, mint: mint.address.toBase58() };
        }
      } catch {
        continue;
      }
    }

    return { isVerified: false, mint: null };
  } catch {
    return { isVerified: false, mint: null };
  }
}


