export type S3Config = {
  upload: (params: { key: string; contentType: string; bytes: Uint8Array }) => Promise<{ url: string; key: string }>;
};

// Thin abstraction: caller provides an uploader (pre-signed URL or SDK) via S3Config
export async function uploadBytes(
  cfg: S3Config,
  key: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<{ url: string; key: string }> {
  return cfg.upload({ key, contentType, bytes });
}


// build a stable s3 key for a photo, organized by Seeker NFT mint address
export function buildS3KeyForPhoto(params: {
  seekerMint: string;
  photoHashHex: string;
  extension?: string; // default: 'jpg'
  basePrefix?: string; // default: 'photos/'
}): string {
  const { seekerMint, photoHashHex } = params;
  const extension = params.extension ?? 'jpg';
  const basePrefix = (params.basePrefix ?? 'photos/').replace(/^\/+|\/+$|^\s+|\s+$/g, '');
  const prefix = basePrefix.length ? `${basePrefix}/` : '';
  return `${prefix}${seekerMint}/${photoHashHex}.${extension}`;
}

// Construct an s3:// URI from bucket and key
export function buildS3Uri(bucket: string, key: string): string {
  const normalizedKey = key.replace(/^\/+/, '');
  return `s3://${bucket}/${normalizedKey}`;
}

// Perform a PUT upload to a presigned URL
export async function putToPresignedUrl(params: {
  url: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<void> {
  const res = await fetch(params.url, {
    method: 'PUT',
    headers: { 'Content-Type': params.contentType },
    body: params.bytes as any,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`S3 upload failed (${res.status}): ${text}`);
  }
}


