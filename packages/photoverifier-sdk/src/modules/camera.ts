import type { CameraView } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';

export type CaptureResult = {
  tempUri: string;
  assetUri: string;
};

export async function captureAndPersist(cameraRef: React.RefObject<CameraView>): Promise<CaptureResult> {
  const pictureRef: any = await (cameraRef as any).current?.takePictureAsync({ pictureRef: true });
  if (!pictureRef) throw new Error('Unable to capture photo');
  const saved = await pictureRef.savePictureAsync();
  if (!saved?.uri) throw new Error('Unable to save temp photo');
  const asset = await MediaLibrary.createAssetAsync(saved.uri);
  const info = await MediaLibrary.getAssetInfoAsync(asset);
  if (!info.localUri) throw new Error('Unable to resolve local asset URI');
  return { tempUri: saved.uri, assetUri: info.localUri };
}

export async function readFileAsBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}


