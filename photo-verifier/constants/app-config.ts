import Constants from 'expo-constants'
import { clusterApiUrl } from '@solana/web3.js'
import { Cluster } from '@/components/cluster/cluster'
import { ClusterNetwork } from '@/components/cluster/cluster-network'

export class AppConfig {
  static name = 'photo-verifier'
  static uri = 'https://example.com'
  // S3 target bucket and folder structure for photos
  static s3 = {
    bucket:
      process.env.EXPO_PUBLIC_S3_BUCKET ||
      ((Constants as any)?.expoConfig?.extra?.s3?.bucket ?? (Constants as any)?.manifest?.extra?.s3?.bucket) ||
      'photoverifier',
    basePrefix:
      process.env.EXPO_PUBLIC_S3_BASE_PREFIX ||
      ((Constants as any)?.expoConfig?.extra?.s3?.basePrefix ?? (Constants as any)?.manifest?.extra?.s3?.basePrefix) ||
      'photos',
    // Backend endpoint that returns { uploadURL, key } for PUT uploads
    presignEndpoint:
      process.env.EXPO_PUBLIC_S3_PRESIGN_ENDPOINT ||
      ((Constants as any)?.expoConfig?.extra?.s3?.presignEndpoint ?? (Constants as any)?.manifest?.extra?.s3?.presignEndpoint) ||
      'https://YOUR_API_ENDPOINT/uploads',
    // Optional: default content type for images captured
    defaultContentType:
      process.env.EXPO_PUBLIC_S3_CONTENT_TYPE ||
      ((Constants as any)?.expoConfig?.extra?.s3?.defaultContentType ?? (Constants as any)?.manifest?.extra?.s3?.defaultContentType) ||
      'image/jpeg',
  }
  static helius = {
    apiKey:
      process.env.EXPO_PUBLIC_HELIUS_API_KEY ||
      ((Constants as any)?.expoConfig?.extra?.helius?.apiKey ?? (Constants as any)?.manifest?.extra?.helius?.apiKey) ||
      '',
  }
  private static parseCsv(value: any): string[] {
    if (!value) return []
    if (Array.isArray(value)) return value.filter(Boolean)
    if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean)
    return []
  }
  // Seeker Genesis Token config: lists of mint addresses per cluster
  static seeker = {
    devnetMints: AppConfig.parseCsv(
      process.env.EXPO_PUBLIC_SEEKER_DEVNET_MINTS ||
        ((Constants as any)?.expoConfig?.extra?.seeker?.devnetMints ?? (Constants as any)?.manifest?.extra?.seeker?.devnetMints),
    ),
    testnetMints: AppConfig.parseCsv(
      process.env.EXPO_PUBLIC_SEEKER_TESTNET_MINTS ||
        ((Constants as any)?.expoConfig?.extra?.seeker?.testnetMints ?? (Constants as any)?.manifest?.extra?.seeker?.testnetMints),
    ),
    mainnetMints: AppConfig.parseCsv(
      process.env.EXPO_PUBLIC_SEEKER_MAINNET_MINTS ||
        ((Constants as any)?.expoConfig?.extra?.seeker?.mainnetMints ?? (Constants as any)?.manifest?.extra?.seeker?.mainnetMints),
    ),
  }
  static clusters: Cluster[] = [
    {
      id: 'solana:devnet',
      name: 'Devnet',
      endpoint: clusterApiUrl('devnet'),
      network: ClusterNetwork.Devnet,
    },
    {
      id: 'solana:testnet',
      name: 'Testnet',
      endpoint: clusterApiUrl('testnet'),
      network: ClusterNetwork.Testnet,
    },
  ]
}
