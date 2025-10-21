import { SettingsUiCluster } from '@/components/settings/settings-ui-cluster'
import { AppText } from '@/components/app-text'
import { SettingsAppConfig } from '@/components/settings/settings-app-config'
import { SettingsUiAccount } from '@/components/settings/settings-ui-account'

import { AppPage } from '@/components/app-page'
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { useRef, useState } from 'react';
import { Button, StyleSheet, Text, TouchableOpacity, View, Linking, Image, ScrollView } from 'react-native';
import { utf8ToBytes } from '@noble/hashes/utils'
import Snackbar from 'react-native-snackbar'
import { useWalletUi } from '@/components/solana/use-wallet-ui'
import { Buffer } from 'buffer'
import { useConnection } from '@/components/solana/solana-provider'
import { useCluster } from '@/components/cluster/cluster-provider'
import { AppConfig } from '@/constants/app-config'
import { blake3HexFromBase64, captureAndPersist, getCurrentLocation, buildS3KeyForPhoto, buildS3Uri, putToPresignedUrl, isSeekerDevice, verifySeekerWithHelius, buildCreatePhotoDataTransaction, derivePhotoDataPda } from '@citizen-science-sdk/photoverifier-sdk'
import { requestPresignedPut } from '@/utils/s3'
import * as Location from 'expo-location'


export default function TabCameraScreen() {
  const [facing, setFacing] = useState<CameraType>('back');
  const [permission, requestPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();
  const [isReady, setIsReady] = useState(false);
  const [isTaking, setIsTaking] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [preHashHex, setPreHashHex] = useState<string | null>(null);
  const [postHashHex, setPostHashHex] = useState<string | null>(null);
  const [hashesMatch, setHashesMatch] = useState<boolean | null>(null);
  const [timestamp, setTimestamp] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState<boolean>(false);
  const [locationValue, setLocationValue] = useState<{ latitude: number; longitude: number; accuracy?: number } | null>(null);
  const [seekerLoading, setSeekerLoading] = useState<boolean>(false);
  const [seekerMintValue, setSeekerMintValue] = useState<string | null>(null);
  const cameraRef = useRef<any>(null);
  const { account, signMessage, signAndSendTransaction } = useWalletUi()
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

  const ensureForegroundLocationPermission = async (): Promise<boolean> => {
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync()
      if (!servicesEnabled) {
        Snackbar.show({
          text: 'Location services are disabled. Enable them to include location metadata.',
          duration: Snackbar.LENGTH_SHORT,
          backgroundColor: 'rgba(176,0,32,0.95)',
          textColor: 'white',
          action: {
            text: 'Settings',
            textColor: 'yellow',
            onPress: () => {
              try { Linking.openSettings() } catch {}
            },
          },
        })
        // Continue without blocking capture; return false to skip location
        return false
      }
      let perm = await Location.getForegroundPermissionsAsync()
      if (perm.status !== 'granted') {
        perm = await Location.requestForegroundPermissionsAsync()
      }
      if (perm.status !== 'granted') {
        Snackbar.show({
          text: 'Location permission denied. Open Settings to grant access.',
          duration: Snackbar.LENGTH_SHORT,
          backgroundColor: 'rgba(176,0,32,0.95)',
          textColor: 'white',
          action: {
            text: 'Settings',
            textColor: 'yellow',
            onPress: () => {
              try { Linking.openSettings() } catch {}
            },
          },
        })
        return false
      }
      return true
    } catch {
      return false
    }
  }

  const handleTakePicture = async () => {
    if (!isReady || isTaking) return;
    try {
      // Ensure we can save to the media library
      if (!mediaPermission?.granted) {
        const result = await requestMediaPermission();
        if (!result?.granted) {
          return;
        }
      }

      // this is where we start writing image to the media library
      setIsTaking(true);
      const { tempUri, assetUri } = await captureAndPersist(cameraRef)

      // 1) Read bytes BEFORE saving to gallery and compute hash
      const preBase64 = await FileSystem.readAsStringAsync(tempUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const preHex = blake3HexFromBase64(preBase64)
      setPreHashHex(preHex)
      const now = new Date().toISOString()
      setTimestamp(now)

      // Begin resolving device location and Seeker NFT in parallel while we continue
      let computedLocation: { latitude: number; longitude: number; accuracy?: number } | null = null
      let computedSeekerMint: string | null = null

      const canUseLocation = await ensureForegroundLocationPermission()
      setLocationLoading(true)
      const locationPromise = canUseLocation ? getCurrentLocation() : Promise.resolve(null)

      setSeekerLoading(true)
      const seekerPromise = (async () => {
        try {
          const ownerStr = account?.publicKey?.toString()
          if (!ownerStr || !AppConfig.helius.apiKey) {
            if (!AppConfig.helius.apiKey) {
              Snackbar.show({ text: 'Missing Helius API key; cannot verify Seeker SGT', duration: Snackbar.LENGTH_SHORT, backgroundColor: 'rgba(176,0,32,0.95)', textColor: 'white' })
            }
            return null
          }
          const res = await verifySeekerWithHelius({ walletAddress: ownerStr, heliusApiKey: AppConfig.helius.apiKey })
          return res.isVerified ? res.mint : null
        } catch { return null }
      })()

      // (We will await these promises after computing the post-save hash)

      // 2) Save to gallery and get asset local URI
      const localUri = assetUri;
      if (!localUri) {
        throw new Error('Unable to resolve saved asset localUri');
      }
      // Enter preview mode immediately with the saved local URI
      setPreviewUri(localUri)
      setIsPreviewing(true)

      // 3) Read bytes AFTER saving to gallery and compute hash
      const postBase64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const postHex = blake3HexFromBase64(postBase64)
      setPostHashHex(postHex)

      // 4) Compare
      const ok = preHex === postHex;
      setHashesMatch(ok)

      // Await background lookups and update progressive states
      try {
        const [locRes, seekerRes] = await Promise.allSettled([locationPromise, seekerPromise])
        computedLocation = locRes.status === 'fulfilled' ? locRes.value : null
        setLocationValue(computedLocation)
        setLocationLoading(false)
        computedSeekerMint = seekerRes.status === 'fulfilled' ? seekerRes.value : null
        // Devnet fallback for Seeker Genesis Token when verification isn't available
        if (!computedSeekerMint && selectedCluster.network === 'devnet') {
          computedSeekerMint = '4mjmWDfmoxZJchYhyEimQa5RtXwoN2AUiABPaCQ9Nmii'
        }
        setSeekerMintValue(computedSeekerMint)
        setSeekerLoading(false)
      } catch {
        setLocationLoading(false)
        setSeekerLoading(false)
      }

      // Defer upload and proof submission to explicit user action in preview UI
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

  const handleDiscard = () => {
    setIsPreviewing(false)
    setPreviewUri(null)
    setPreHashHex(null)
    setPostHashHex(null)
    setHashesMatch(null)
    setTimestamp(null)
    setLocationLoading(false)
    setLocationValue(null)
    setSeekerLoading(false)
    setSeekerMintValue(null)
  }

  const handleUploadAndSubmit = async () => {
    try {
      if (!previewUri || !preHashHex) {
        Snackbar.show({ text: 'Missing preview or hash', duration: Snackbar.LENGTH_SHORT, backgroundColor: 'rgba(176,0,32,0.95)', textColor: 'white' })
        return
      }
      const owner = account?.publicKey?.toString()
      const ts = timestamp ?? new Date().toISOString()
      const seekerMint = seekerMintValue

      // Snapshot current values to allow background proof creation even if we reset UI
      const snapshot = {
        hashHex: preHashHex,
        localUri: previewUri,
        ts,
        location: locationValue,
        owner,
        seekerMint,
      }

      let remoteUri: string | null = null
      try {
        if (!seekerMint) {
          const deviceMsg = isSeekerDevice() ? 'on Seeker device but no SGT in wallet' : 'not a Seeker device'
          Snackbar.show({ text: `Requires Seeker to upload: ${deviceMsg}`, duration: Snackbar.LENGTH_SHORT, backgroundColor: 'rgba(33,33,33,0.95)', textColor: 'white' })
        } else {
          const key = buildS3KeyForPhoto({
            seekerMint,
            photoHashHex: preHashHex,
            extension: 'jpg',
            basePrefix: AppConfig.s3.basePrefix,
          })
          const { uploadURL, key: returnedKey } = await requestPresignedPut(AppConfig.s3.presignEndpoint, {
            key,
            contentType: AppConfig.s3.defaultContentType,
          })
          const bytes = await FileSystem.readAsStringAsync(previewUri, { encoding: FileSystem.EncodingType.Base64 })
          const u8 = Uint8Array.from(Buffer.from(bytes, 'base64'))
          await putToPresignedUrl({ url: uploadURL, bytes: u8, contentType: AppConfig.s3.defaultContentType })
          remoteUri = buildS3Uri(AppConfig.s3.bucket, returnedKey || key)
          Snackbar.show({ text: 'Uploaded photo to S3', duration: Snackbar.LENGTH_SHORT, backgroundColor: 'rgba(76, 175, 80, 0.95)', textColor: 'white' })

          // On-chain submit (separate step so wallet cancellation isn’t reported as S3 failure)
          try {
            if (!account?.publicKey || !remoteUri) return
            const locationString = locationValue ? `${locationValue.latitude},${locationValue.longitude}` : ''
            if (remoteUri.length > 256) {
              Snackbar.show({ text: 'S3 URI too long (>256)', duration: Snackbar.LENGTH_SHORT, backgroundColor: 'rgba(176,0,32,0.95)', textColor: 'white' })
              return
            }
            if (locationString.length > 256) {
              Snackbar.show({ text: 'Location string too long (>256)', duration: Snackbar.LENGTH_SHORT, backgroundColor: 'rgba(176,0,32,0.95)', textColor: 'white' })
              return
            }

            const hashBytes = Uint8Array.from(Buffer.from(preHashHex, 'hex'))
            const [pda] = derivePhotoDataPda(account.publicKey, hashBytes, ts)
            const existing = await connection.getAccountInfo(pda)
            if (existing) {
              Snackbar.show({ text: 'Photo already recorded on-chain (PDA exists)', duration: Snackbar.LENGTH_SHORT, backgroundColor: 'rgba(33,33,33,0.95)', textColor: 'white' })
              return
            }

            const { transaction } = await buildCreatePhotoDataTransaction({
              connection,
              payer: account.publicKey,
              hash32: hashBytes,
              s3Uri: remoteUri,
              location: locationString,
              timestamp: ts,
            })

            const {
              context: { slot: minContextSlot },
            } = await connection.getLatestBlockhashAndContext()
            const simRes = await connection.simulateTransaction(transaction as any, { replaceRecentBlockhash: true, sigVerify: false })

            if (simRes.value.err) {
              console.log('Simulation logs:', simRes.value.logs)
              Snackbar.show({ text: 'Simulation failed (see logs)', duration: Snackbar.LENGTH_SHORT, backgroundColor: 'rgba(176,0,32,0.95)', textColor: 'white' })
              return
            }

            const signature = await signAndSendTransaction(transaction as any, minContextSlot)

            Snackbar.show({ text: 'Submitted on-chain transaction', duration: Snackbar.LENGTH_SHORT, backgroundColor: 'rgba(76, 175, 80, 0.95)', textColor: 'white' })

            handleDiscard()
            try { Linking.openURL(`https://solscan.io/tx/${signature}?cluster=${selectedCluster.network}`) } catch {}
          } catch (err: any) {
            const msg = String(err || '')
            const friendly = msg.includes('CancellationException') ? 'Wallet request canceled' : (err?.message ?? 'unknown error')
            Snackbar.show({ text: `On-chain submit failed: ${friendly}`, duration: Snackbar.LENGTH_SHORT, backgroundColor: 'rgba(176,0,32,0.95)', textColor: 'white' })
          }
        }
      } catch (e: any) {
        console.log('S3 upload error', e)
        Snackbar.show({ text: `S3 upload failed: ${e?.message ?? 'unknown error'}`, duration: Snackbar.LENGTH_SHORT, backgroundColor: 'rgba(176,0,32,0.95)', textColor: 'white' })
      }

    } catch (e: any) {
      Snackbar.show({ text: `Error: ${e?.message ?? 'Unknown error'}`, duration: Snackbar.LENGTH_SHORT, backgroundColor: 'rgba(176,0,32,0.95)', textColor: 'white' })
    }
  }

  return (
    <View style={styles.container}>
      {!isPreviewing ? (
        <>
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing={facing}
            onCameraReady={() => setIsReady(true)}
          />
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
        </>
      ) : (
        <View style={styles.previewContainer}>
          {!!previewUri && (
            <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="contain" />
          )}
          <View style={styles.statsPanel}>
            <ScrollView style={{ maxHeight: 200 }}>
              <Text style={styles.statText}>Time: {timestamp ?? 'loading...'}</Text>
              <Text style={styles.statText}>Hash (pre): {preHashHex ?? 'loading...'}</Text>
              <Text style={styles.statText}>Hash (post): {postHashHex ?? 'loading...'}</Text>
              <Text style={styles.statText}>Match: {hashesMatch == null ? 'loading...' : (hashesMatch ? 'verified' : 'mismatch')}</Text>
              <Text style={styles.statText}>
                Location: {locationLoading ? 'loading...' : (locationValue ? `${locationValue.latitude.toFixed(5)}, ${locationValue.longitude.toFixed(5)}${locationValue.accuracy ? ` ±${Math.round(locationValue.accuracy)}m` : ''}` : 'unavailable')}
              </Text>
              <Text style={styles.statText}>Seeker: {seekerLoading ? 'loading...' : (seekerMintValue ?? 'none')}</Text>
            </ScrollView>
            <View style={styles.previewButtons}>
              <TouchableOpacity onPress={handleDiscard} style={[styles.actionButton, styles.discardButton]}>
                <Text style={styles.actionText}>Discard</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleUploadAndSubmit} style={[styles.actionButton, styles.uploadButton]}>
                <Text style={styles.actionText}>Upload & Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
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
  previewContainer: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    flex: 1,
    width: '100%',
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
  statsPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  statText: {
    color: 'white',
    fontSize: 14,
    marginBottom: 6,
  },
  previewButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  discardButton: {
    backgroundColor: 'rgba(176,0,32,0.9)',
  },
  uploadButton: {
    backgroundColor: 'rgba(76,175,80,0.9)',
  },
  actionText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
});