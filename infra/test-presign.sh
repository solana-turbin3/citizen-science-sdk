#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./test-presign.sh <presign-url> <bucket> <seekerMint> <hash> <image-path>

PRESIGN_URL=${1:?presign url required}
BUCKET=${2:?bucket required}
SEEKER=${3:?seekerMint required}
HASH=${4:?hash required}
IMG=${5:?image file required}

KEY="photos/${SEEKER}/${HASH}.jpg"
CT="image/jpeg"

echo "Requesting presigned URL for key: ${KEY}"
RESP=$(curl -sS -X POST -H 'Content-Type: application/json' \
  --data "{\"key\":\"${KEY}\",\"contentType\":\"${CT}\"}" \
  "${PRESIGN_URL}")

UPLOAD_URL=$(echo "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{let j=JSON.parse(s);console.log(j.uploadURL||'')}catch(e){process.exit(1)}})")

if [[ -z "$UPLOAD_URL" ]]; then
  echo "Failed to parse presign response: $RESP" >&2
  exit 1
fi

echo "Uploading ${IMG} to S3 via presigned URL..."
curl -sS -X PUT -H "Content-Type: ${CT}" --data-binary @"${IMG}" "${UPLOAD_URL}" -o /dev/null -w "%{http_code}\n"

echo "Verifying object exists: s3://${BUCKET}/${KEY}"
aws s3 ls "s3://${BUCKET}/${KEY}" || { echo "Object not found" >&2; exit 1; }
echo "Done."


