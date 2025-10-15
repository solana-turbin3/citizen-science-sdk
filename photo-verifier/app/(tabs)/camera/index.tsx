import { SettingsUiCluster } from '@/components/settings/settings-ui-cluster'
import { AppText } from '@/components/app-text'
import { SettingsAppConfig } from '@/components/settings/settings-app-config'
import { SettingsUiAccount } from '@/components/settings/settings-ui-account'

import { AppPage } from '@/components/app-page'
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { useRef, useState } from 'react';
import { Button, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { blake3 } from '@noble/hashes/blake3'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import { toUint8Array } from 'js-base64'
import Snackbar from 'react-native-snackbar'
import { useWalletUi } from '@/components/solana/use-wallet-ui'
import { Buffer } from 'buffer'
import { useConnection } from '@/components/solana/solana-provider'
import { useCluster } from '@/components/cluster/cluster-provider'
import { AppConfig } from '@/constants/app-config'
import { NativeModulesProxy } from 'expo-modules-core'


export default function TabCameraScreen() {
  const [facing, setFacing] = useState<CameraType>('back');
  const [permission, requestPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();
  const [isReady, setIsReady] = useState(false);
  const [isTaking, setIsTaking] = useState(false);
  const cameraRef = useRef<any>(null);
  const { account, signMessage } = useWalletUi()
  const connection = useConnection()
  const { selectedCluster } = useCluster()

  if (!permission) {
    // Camera permissions are still loading.
    return <View />;
  }

  if (!permission.granted) {
    // Camera permissions are not granted yet.
    return (
      <View style={styles.container}>
        <Text style={styles.message}>We need your permission to show the camera</Text>
        <Button onPress={requestPermission} title="grant permission" />
      </View>
    );
  }

  function toggleCameraFacing() {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  }

  const handleTakePicture = async () => {
    if (!isReady || isTaking) return;
    try {
      // show immediate feedback via toasts only
      // Ensure we can save to the media library
      if (!mediaPermission?.granted) {
        const result = await requestMediaPermission();
        if (!result?.granted) {
          return;
        }
      }

      // this is where we start writing image to the media library
      setIsTaking(true);
      const pictureRef = await cameraRef.current?.takePictureAsync({ pictureRef: true });
      if (!pictureRef) return;
      // materialize captured image into a temporary file (not yet in gallery)
      const saved = await pictureRef.savePictureAsync();
      if (!saved?.uri) return;

      // 1) Read bytes BEFORE saving to gallery and compute hash
      const preBase64 = await FileSystem.readAsStringAsync(saved.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const preBytes = toUint8Array(preBase64);
      const preHex = bytesToHex(blake3(preBytes));

      // Begin resolving device location and Seeker NFT in parallel while we continue
      let computedLocation: { latitude: number; longitude: number; accuracy?: number } | null = null
      let computedSeekerMint: string | null = null

      const locationPromise = (async () => {
        try {
          // Only attempt to access if the native module exists in this dev client
          if (!NativeModulesProxy || !(NativeModulesProxy as any).ExpoLocation) return null
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const Location: any = require('expo-location')
          const perm = await Location.requestForegroundPermissionsAsync()
          if (perm.status === 'granted') {
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low })
            return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }
          }
        } catch {}
        return null
      })()

      const seekerPromise = (async () => {
        try {
          const owner = account?.publicKey?.toString()
          if (!owner) return null
          const ownerKey = new (await import('@solana/web3.js')).PublicKey(owner)
          const seekerMintsByCluster = (() => {
            switch (selectedCluster.network) {
              case 'devnet':
                return AppConfig.seeker.devnetMints
              case 'testnet':
                return AppConfig.seeker.testnetMints
              default:
                return AppConfig.seeker.mainnetMints
            }
          })()
          if (seekerMintsByCluster.length === 0) return null
          const TOKEN_PROGRAM_ID = (await import('@solana/spl-token')).TOKEN_PROGRAM_ID
          const TOKEN_2022_PROGRAM_ID = (await import('@solana/spl-token')).TOKEN_2022_PROGRAM_ID
          const [tokenAccounts, token2022Accounts] = await Promise.all([
            connection.getParsedTokenAccountsByOwner(ownerKey, { programId: TOKEN_PROGRAM_ID }),
            connection.getParsedTokenAccountsByOwner(ownerKey, { programId: TOKEN_2022_PROGRAM_ID }),
          ])
          const allAccounts = [...tokenAccounts.value, ...token2022Accounts.value]
          for (const acc of allAccounts) {
            const parsed: any = acc.account.data
            const mint: string | undefined = parsed?.parsed?.info?.mint
            const amount: string | undefined = parsed?.parsed?.info?.tokenAmount?.amount
            const decimals: number | undefined = parsed?.parsed?.info?.tokenAmount?.decimals
            if (mint && seekerMintsByCluster.includes(mint) && amount !== '0') {
              // Prefer NFTs (decimals 0), else first match
              return mint
            }
          }
        } catch {}
        return null
      })()

      // (We will await these promises after computing the post-save hash)

      // 2) Save to gallery and get asset local URI
      const asset = await MediaLibrary.createAssetAsync(saved.uri);
      const info = await MediaLibrary.getAssetInfoAsync(asset);
      const localUri = info.localUri;
      if (!localUri) {
        throw new Error('Unable to resolve saved asset localUri');
      }

      // 3) Read bytes AFTER saving to gallery and compute hash
      const postBase64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const postBytes = toUint8Array(postBase64);
      const postHex = bytesToHex(blake3(postBytes));

      // 4) Compare
      const ok = preHex === postHex;
      const timestamp = new Date().toISOString()

      // Await background lookups and show a single summary message
      try {
        const [locRes, seekerRes] = await Promise.allSettled([locationPromise, seekerPromise])
        computedLocation = locRes.status === 'fulfilled' ? locRes.value : null
        computedSeekerMint = seekerRes.status === 'fulfilled' ? seekerRes.value : null
        const locText = computedLocation
          ? `${computedLocation.latitude.toFixed(5)}, ${computedLocation.longitude.toFixed(5)}${
              computedLocation.accuracy ? ` ±${Math.round(computedLocation.accuracy)}m` : ''
            }`
          : 'unavailable'
        const seekerText = computedSeekerMint ?? 'none'
        const matchText = ok ? 'verified' : 'mismatch'
        Snackbar.show({
          text: `Time: ${timestamp}\nHash: ${preHex}\nMatch: ${matchText}\nLocation: ${locText}\nSeeker: ${seekerText}`,
          duration: Snackbar.LENGTH_SHORT,
          backgroundColor: 'rgba(33, 33, 33, 0.95)',
          textColor: 'white',
          numberOfLines: 8,
        })
      } catch {}

      // 5) Build signed payload with timestamp, location, owner and persist a local proof
      const location = computedLocation

      const owner = account?.publicKey?.toString()

      // Use resolved Seeker NFT mint address, if any
      const seekerMint: string | null = computedSeekerMint
      const payload = {
        hash: preHex,
        uri: localUri,
        timestamp,
        location,
        owner,
        seekerMint,
      }
      const payloadJson = JSON.stringify(payload)
      let signatureBase64: string | null = null
      try {
        const sigBytes = await signMessage(Buffer.from(utf8ToBytes(payloadJson)))
        signatureBase64 = Buffer.from(sigBytes).toString('base64')
      } catch (e) {
        Snackbar.show({ text: 'Unable to sign payload with wallet', duration: Snackbar.LENGTH_SHORT, backgroundColor: 'rgba(176, 0, 32, 0.95)', textColor: 'white' })
      }

      const proof = { payload, signature: signatureBase64 }
      try {
        const dir = FileSystem.documentDirectory ? FileSystem.documentDirectory + 'proofs' : null
        if (dir) {
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {})
          const path = `${dir}/proof-${preHex}.json`
          await FileSystem.writeAsStringAsync(path, JSON.stringify(proof))
          Snackbar.show({ text: 'Signed image proof saved', duration: Snackbar.LENGTH_SHORT, backgroundColor: 'rgba(76, 175, 80, 0.95)', textColor: 'white' })
        }
      } catch {}
    } catch (e: any) {
      Snackbar.show({
        text: `Error: ${e?.message ?? 'Unknown error'}`,
        duration: Snackbar.LENGTH_SHORT,
        backgroundColor: 'rgba(176, 0, 32, 0.95)',
        textColor: 'white',
      })
    } finally {
      setIsTaking(false);
    }
  };

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        onCameraReady={() => setIsReady(true)}
      />
      {/* Toasts replace inline status UI */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.button} onPress={toggleCameraFacing}>
          <Text style={styles.text}>Flip Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.button}
          onPress={handleTakePicture}
          disabled={!isReady || isTaking}
        >
          <View style={[styles.shutter, isTaking ? { opacity: 0.6 } : null]} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  message: {
    textAlign: 'center',
    paddingBottom: 10,
  },
  camera: {
    flex: 1,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 64,
    flexDirection: 'row',
    backgroundColor: 'transparent',
    width: '100%',
    paddingHorizontal: 64,
  },
  button: {
    flex: 1,
    alignItems: 'center',
  },
  shutter: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 4,
    borderColor: 'white',
    backgroundColor: 'transparent',
  },
  text: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
});