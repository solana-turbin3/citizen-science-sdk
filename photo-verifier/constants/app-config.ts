import { clusterApiUrl } from '@solana/web3.js'
import { Cluster } from '@/components/cluster/cluster'
import { ClusterNetwork } from '@/components/cluster/cluster-network'

export class AppConfig {
  static name = 'photo-verifier'
  static uri = 'https://example.com'
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
  // Seeker Genesis Token config (example placeholder mints per cluster)
  static seeker = {
    devnetMints: [] as string[],
    testnetMints: [] as string[],
    mainnetMints: [] as string[],
  }
}
