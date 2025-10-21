export type PresignResponse = {
  uploadURL: string;
  key: string;
};

export async function requestPresignedPut(endpoint: string, params: {
  key: string;
  contentType: string;
  // optional fields if backend wants hints
}): Promise<PresignResponse> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to request presigned URL (${res.status}): ${text}`);
  }
  return res.json();
}


