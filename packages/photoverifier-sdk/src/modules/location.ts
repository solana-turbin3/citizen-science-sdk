export type SimpleLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number;
};

// Get a simple foreground location using Expo Location when available.
// Returns last known location as a fallback if current position cannot be retrieved.
export async function getCurrentLocation(): Promise<SimpleLocation | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Location: any = require('expo-location');

    // Ensure services enabled when API is available
    if (typeof Location.hasServicesEnabledAsync === 'function') {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (servicesEnabled === false) return null;
    }

    // Check/request foreground permission
    let status: string | undefined;
    if (typeof Location.getForegroundPermissionsAsync === 'function') {
      const existing = await Location.getForegroundPermissionsAsync();
      status = existing?.status;
    }
    if (status !== 'granted' && typeof Location.requestForegroundPermissionsAsync === 'function') {
      const requested = await Location.requestForegroundPermissionsAsync();
      status = requested?.status;
    }
    if (status !== 'granted') return null;

    // Try current position first
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      return {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
    } catch {}

    // Fallback to last known position
    if (typeof Location.getLastKnownPositionAsync === 'function') {
      const last = await Location.getLastKnownPositionAsync();
      if (last?.coords) {
        return {
          latitude: last.coords.latitude,
          longitude: last.coords.longitude,
          accuracy: last.coords.accuracy,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}


