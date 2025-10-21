#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./deploy.sh <stack-name> <bucket-name> [allowed-origin]
# Example:
#   ./deploy.sh photoverifier-presign photoverifier https://yourapp.example

STACK_NAME=${1:-photoverifier-presign}
BUCKET_NAME=${2:-photoverifier}
ALLOWED_ORIGIN=${3:-'*'}

TEMPLATE_FILE="$(cd "$(dirname "$0")" && pwd)/presign-api.yaml"
CORS_FILE="$(cd "$(dirname "$0")" && pwd)/s3-cors.json"

echo "Setting S3 CORS on bucket: ${BUCKET_NAME}"
aws s3api put-bucket-cors --bucket "${BUCKET_NAME}" --cors-configuration file://"${CORS_FILE}"

echo "Deploying CloudFormation stack: ${STACK_NAME}"
aws cloudformation deploy \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE_FILE}" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides BucketName="${BUCKET_NAME}" AllowedOrigin="${ALLOWED_ORIGIN}" UrlExpirySeconds=300

ENDPOINT=$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' --output text)
echo "API Endpoint: ${ENDPOINT}"
echo "Presign URL:  ${ENDPOINT}/uploads"


