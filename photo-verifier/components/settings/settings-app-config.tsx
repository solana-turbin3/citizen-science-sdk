import { AppConfig } from '@/constants/app-config'
import { AppText } from '@/components/app-text'
import { AppView } from '@/components/app-view'
import { AppExternalLink, AppExternalLinkProps } from '@/components/app-external-link'
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js'
import Snackbar from 'react-native-snackbar'
import { Button } from '@react-navigation/elements'
import { useCluster } from '@/components/cluster/cluster-provider'

export function SettingsAppConfig() {
  const { selectedCluster } = useCluster()
  return (
    <AppView>
      <AppText type="subtitle">App Config</AppText>
      <AppText type="default">
        Name <AppText type="defaultSemiBold">{AppConfig.name}</AppText>
      </AppText>
      <AppText type="default">
        URL{' '}
        <AppText type="link">
          <AppExternalLink href={AppConfig.uri as AppExternalLinkProps['href']}>{AppConfig.uri}</AppExternalLink>
        </AppText>
      </AppText>
      {/* <Button
        variant="filled"
        onPress={async () => {
          try {
            const authorizationResult = await transact(async (wallet) => {
              return wallet.authorize({
                chain: selectedCluster.id as any,
                identity: { name: AppConfig.name, uri: AppConfig.uri },
                sign_in_payload: {
                  domain: AppConfig.uri.replace(/^https?:\/\//, ''),
                  statement: 'Sign in to verify Seeker ownership',
                  uri: AppConfig.uri,
                },
              })
            })
            // TODO: send authorizationResult.sign_in_result to backend to verify SIWS and SGT ownership
            Snackbar.show({ text: 'SIWS completed. Verify SGT on backend.', duration: Snackbar.LENGTH_SHORT })
          } catch (e: any) {
            Snackbar.show({ text: `SIWS failed: ${e?.message ?? 'Unknown error'}`, duration: Snackbar.LENGTH_SHORT })
          }
        }}
      >
        Verify Seeker (SIWS)
      </Button> */}
    </AppView>
  )
}
