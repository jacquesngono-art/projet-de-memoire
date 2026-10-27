export interface BrowserGeoPosition {
  lat: number
  lon: number
  accuracy: number | null
}

interface PrecisePositionOptions {
  timeoutMs?: number
  desiredAccuracyM?: number
  onUpdate?: (position: BrowserGeoPosition) => void
}

function toBrowserPosition(pos: GeolocationPosition): BrowserGeoPosition {
  return {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? null,
  }
}

export function getPreciseBrowserPosition({
  timeoutMs = 12000,
  desiredAccuracyM = 75,
  onUpdate,
}: PrecisePositionOptions = {}) {
  return new Promise<BrowserGeoPosition>((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Géolocalisation non supportée"))
      return
    }

    let best: GeolocationPosition | null = null
    let watchId: number | null = null
    let settled = false
    let fallbackStarted = false

    const emitBest = () => {
      if (best) onUpdate?.(toBrowserPosition(best))
    }

    const cleanup = () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
      window.clearTimeout(timer)
    }

    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      if (!best) {
        reject(new Error("Position indisponible"))
        return
      }
      resolve(toBrowserPosition(best))
    }

    const fail = (error: GeolocationPositionError) => {
      if (settled) return
      if (best) {
        finish()
        return
      }
      if (!fallbackStarted) {
        fallbackStarted = true
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            best = pos
            emitBest()
            finish()
          },
          fail,
          {
            enableHighAccuracy: false,
            timeout: Math.min(6000, timeoutMs),
            maximumAge: 30000,
          }
        )
        return
      }
      settled = true
      cleanup()
      reject(error)
    }

    const timer = window.setTimeout(finish, timeoutMs)

    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const accuracy = pos.coords.accuracy ?? Number.POSITIVE_INFINITY
          if (!best || accuracy < (best.coords.accuracy ?? Number.POSITIVE_INFINITY)) {
            best = pos
            emitBest()
          }
          if (accuracy <= desiredAccuracyM) finish()
        },
        fail,
        { enableHighAccuracy: true, timeout: Math.min(6000, timeoutMs), maximumAge: 0 }
      )
    } catch (error) {
      fail(error as GeolocationPositionError)
    }
  })
}

export function formatAccuracyM(accuracy: number | null | undefined) {
  if (accuracy == null || !Number.isFinite(accuracy)) return null
  if (accuracy >= 1000) return `±${(accuracy / 1000).toFixed(1)} km`
  return `±${Math.round(accuracy)} m`
}

/**
 * ── Garde-fou de vraisemblance ──
 * Sur un appareil sans GPS (PC de bureau, Wi-Fi), le navigateur estime la
 * position par triangulation Wi-Fi/adresses FAI : l'erreur peut atteindre
 * plusieurs centaines de kilomètres (ex : un utilisateur de Yaoundé
 * placé à Douala). On refuse donc une position détectée trop loin de la
 * zone couverte par le catalogue de biens — elle ne doit ni déplacer la
 * caméra ni créer un faux point bleu GPS.
 */
const CATALOG_ANCHORS: Array<[number, number]> = [
  [3.8667, 11.5167], // Yaoundé (Poste Centrale / centre-ville)
  [3.7611, 11.8264], // Mfou (limite est du catalogue)
]

function toRad(d: number) {
  return (d * Math.PI) / 180
}

/** Distance Haversine en km entre deux points (lat/lon en degrés). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Distance (km) du point aux ancres de la zone couverte par le catalogue. */
export function distanceToCatalogKm(lat: number, lon: number) {
  return Math.min(...CATALOG_ANCHORS.map(([la, lo]) => distanceKm(lat, lon, la, lo)))
}

/**
 * La position est-elle plausible pour un catalogue centré grand Yaoundé (+Mfou)?
 * Yaoundé–Douala ≈ 200 km : une "position" à Douala sur une machine sans GPS
 * est quasi certainement une erreur de triangulation Wi-Fi, pas une réalité.
 * Seuil par défaut : 90 km.
 */
export function isLocationPlausible(lat: number, lon: number, maxKm = 90) {
  return distanceToCatalogKm(lat, lon) <= maxKm
}
