"use client";
import { useEffect, useMemo, useState } from "react";
import { blake3 } from "@noble/hashes/blake3";
import { bytesToHex } from "@noble/hashes/utils";

const verifiedCache = new Map<string, boolean>();

type PhotoItem = {
  key: string;
  url: string;
  seekerMint: string;
  hashHex: string;
  // Optional metadata from proof file if present
  timestamp?: string;
  location?: string | null;
  owner?: string | null;
  signature?: string | null;
  proofUrl?: string | null;
  tx?: string | null;
};

type ApiResponse = {
  items: PhotoItem[];
  bucket: string;
  prefix: string;
};

export default function Gallery() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/list");
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const json = (await res.json()) as ApiResponse;
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!data?.items?.length) return;
      // Seed from cache to avoid re-hashing on remounts
      const seed: Record<string, boolean> = {};
      for (const it of data.items) {
        if (verifiedCache.has(it.key)) seed[it.key] = verifiedCache.get(it.key)!;
      }
      if (Object.keys(seed).length) setVerified((m) => ({ ...seed, ...m }));

      for (const item of data.items) {
        if (!item.hashHex) continue;
        if (verified[item.key] || verifiedCache.has(item.key)) continue;
        try {
          const res = await fetch(item.url, { method: "GET" });
          if (!res.ok) throw new Error("image fetch failed");
          const buf = await res.arrayBuffer();
          const digest = blake3(new Uint8Array(buf));
          const hex = bytesToHex(digest);
          if (cancelled) return;
          const ok = hex === item.hashHex.toLowerCase();
          verifiedCache.set(item.key, ok);
          setVerified((m) => ({ ...m, [item.key]: ok }));
        } catch {
          if (cancelled) return;
          verifiedCache.set(item.key, false);
          setVerified((m) => ({ ...m, [item.key]: false }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  const groups = useMemo(() => {
    const map = new Map<string, PhotoItem[]>();
    for (const it of data?.items ?? []) {
      const key = it.seekerMint || "unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return [...map.entries()].map(([seekerMint, items]) => ({ seekerMint, items }));
  }, [data]);

  if (loading) return <div className="status">Loading…</div>;
  if (error) return <div className="status">Error: {error}</div>;
  if (!groups.length) return <div className="status">No photos found.</div>;

  return (
    <div>
      {groups.map((g) => (
        <section key={g.seekerMint} className="group">
          <h2 className="group-title">
            Seeker: {g.seekerMint}
            {g.seekerMint && g.seekerMint !== "unknown" ? (
              <> · <a href={`https://solscan.io/token/${g.seekerMint}`} target="_blank" rel="noreferrer noopener">View on Solscan</a></>
            ) : null}
          </h2>
          <div className="cards" role="list">
            {g.items.map((item) => (
              <article className="card" role="listitem" key={item.key}>
                  <div className="image-wrap">
                  <img className="photo" src={item.url} alt="Seeker photo" loading="lazy" />
                </div>
                <div className="meta">
                  <div><strong>Hash</strong>: <span className="hash">{formatHash(item.hashHex)}</span></div>
                {verified[item.key] ? (
                  <div className="row verified"><strong>Status</strong>: <span className="verified-badge">✓ Verified</span></div>
                ) : null}
                  <div className="row"><strong>Location</strong>: <span className="location">{formatLocation(item.location)}</span></div>
                  <div className="row"><strong>Timestamp</strong>: <span className="timestamp">{item.timestamp || "—"}</span></div>
                  <div className="row"><strong>Owner</strong>: <span className="owner">{formatOwner(item.owner)}</span></div>
                  <div className="row"><strong>Signature</strong>: <span className="signature">{item.signature ? item.signature.slice(0, 16) + "…" : "—"}</span></div>
                  <div className="row"><strong>S3</strong>: <a className="s3-link" href={item.url} target="_blank" rel="noreferrer noopener">Open</a></div>
                  {item.proofUrl && (
                    <div className="row proof"><strong>Proof</strong>: <a className="proof-link" href={item.proofUrl} target="_blank" rel="noreferrer noopener">JSON</a></div>
                  )}
                  {item.tx && (
                    <div className="row tx"><strong>Transaction</strong>: <a className="tx-link" href={item.tx} target="_blank" rel="noreferrer noopener">View</a></div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function formatLocation(loc: PhotoItem["location"]) {
  if (!loc) return "—";
  return String(loc);
}

function formatHash(hash?: string | null) {
  if (!hash) return "—";
  const s = String(hash);
  if (s.length <= 12) return s;
  const head = s.slice(0, 5);
  const tail = s.slice(-5);
  return `${head}...${tail}`;
}

function formatOwner(owner?: string | null) {
  if (!owner) return "—";
  return formatHash(owner);
}


