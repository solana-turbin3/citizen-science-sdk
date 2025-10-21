import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import { toUint8Array } from 'js-base64';

export function blake3HexFromBase64(base64: string): string {
  const bytes = toUint8Array(base64);
  return bytesToHex(blake3(bytes));
}

export function blake3HexFromBytes(bytes: Uint8Array): string {
  return bytesToHex(blake3(bytes));
}


