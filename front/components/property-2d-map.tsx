"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import * as maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { LocateFixed } from "lucide-react"
import { formatAccuracyM, getPreciseBrowserPosition, isLocationPlausible, distanceToCatalogKm, type BrowserGeoPosition } from "@/lib/geolocation"

// Contournement d'un bug de Turbopack (bundler de Next.js) qui empêche le
// Web Worker de maplibre-gl de se charger correctement (imports internes
// non réécrits). Sans worker, la carte reste bloquée sur son style de fond
// et n'affiche jamais aucune tuile. On pointe donc vers une copie du worker
// vendorisée dans public/maplibre (voir scripts/sync-maplibre-worker.mjs).
// Voir: https://github.com/vercel/next.js/issues/98137
if (typeof window !== "undefined") {
  maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")
  // Perf : MapLibre n'utilise qu'UN seul worker par défaut (sauf Safari).
  // Monter à ~4 workers parallélise le décodage/parsing des tuiles
  // vectorielles => la carte s'affiche plus vite.
  maplibregl.setWorkerCount(Math.min(4, navigator.hardwareConcurrency || 2))
}

// Yaoundé (centre-ville) — vue par défaut.
const DEFAULT_CENTER: [number, number] = [11.5167, 3.8667]
const CITY_ZOOM = 12.5

interface PropertyMapItem {
  ad_id?: string
  id?: string
  title?: string
  price?: number
  latitude?: number
  longitude?: number
  city?: string
  district?: string
  bedrooms?: number
  bathrooms?: number
  photos?: Array<any>
}

interface Property2DMapProps {
  properties: PropertyMapItem[]
  onMarkerClick?: (id: string) => void
  /** Bien ciblé : itinéraire tracé vers ce bien */
  destination?: PropertyMapItem | null
  onCloseRoute?: () => void
  onViewProperty?: (id: string) => void
  /** Expose les actions de carte au parent (flyTo, zone, position, autoFit) */
  onMapActions?: (actions: {
    flyToProperty: (lat: number, lon: number, title?: string) => void
    flyToZone: (lat: number, lon: number, radiusKm?: number) => void
    getUserPosition: () => [number, number] | null
    setUserPosition: (lon: number, lat: number, accuracy?: number | null) => void
    setSuppressAutoFit: (v: boolean) => void
  }) => void
  /** Appelé quand l'itinéraire est calculé (km, durée) ou annulé */
  onRouteInfo?: (info: { km: number; min: number } | null, loading: boolean) => void
}

/**
 * Version 2D de la carte (style MapTiler identique, mais vue à plat) :
 * - pitch 0 => frustum réduit, beaucoup moins de tuiles vectorielles à charger
 * - pas de couche fill-extrusion (bâtiments 3D) => quasi pas de coût GPU
 * La version 3D est conservée dans property-3d-map.tsx (branche `carte-3D`).
 */
export function Property2DMap({ properties, onMarkerClick, destination, onCloseRoute, onViewProperty, onMapActions, onRouteInfo }: Property2DMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)
  const userPosRef = useRef<[number, number] | null>(null)
  const userAccuracyRef = useRef<number | null>(null)
  const routeOriginMarkerRef = useRef<maplibregl.Marker | null>(null)
  const destMarkerRef = useRef<maplibregl.Marker | null>(null)
  const placeMarkerRef = useRef<maplibregl.Marker | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [routeInfo, setRouteInfo] = useState<{ km: number; min: number } | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [geoLocating, setGeoLocating] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const geoStartedRef = useRef(false)
  const autoCenteredOnUserRef = useRef(false)
  // Quand true, le prochain updateMarkers ne re-fittera pas les bounds (zone search)
  const suppressNextAutoFitRef = useRef(false)
  // Signature du jeu de biens affichés (ids+prix) : permet de sauter la
  // reconstruction complète des marqueurs si le parent re-render avec les
  // mêmes données (ex: drag de la card => setState à chaque pointermove).
  const markersSigRef = useRef<string>("")

  // Fly to a specific property (place search) with a destination pin
  const flyToProperty = useCallback((lat: number, lon: number, title?: string) => {
    const map = mapRef.current
    if (!map) return
    placeMarkerRef.current?.remove()
    const el = document.createElement("div")
    el.innerHTML = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 3px 4px rgba(0,0,0,0.4));">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z" fill="#dc2626" stroke="white" stroke-width="1.5"/>
    </svg>`
    el.style.cssText = "cursor: pointer; pointer-events: auto;"
    if (title) el.title = title
    placeMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([lon, lat])
      .addTo(map)
    map.flyTo({
      center: [lon, lat],
      zoom: 16,
      duration: 1200,
      essential: true,
    })
  }, [])

  // Fit map to a zone around user position (zone search)
  const flyToZone = useCallback((lat: number, lon: number, radiusKm: number = 5) => {
    const map = mapRef.current
    if (!map) return
    const deg = radiusKm / 111
    map.fitBounds(
      [
        [lon - deg, lat - deg],
        [lon + deg, lat + deg],
      ],
      { duration: 1000, padding: 80 }
    )
  }, [])

  // Initialize map once
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    let map: maplibregl.Map

    try {
      map = new maplibregl.Map({
        container: mapContainer.current,
        style: `https://api.maptiler.com/maps/streets/style.json?key=pZbOuTTgEMlz7km8AJvW`,
        center: DEFAULT_CENTER, // Yaoundé (centre-ville)
        zoom: CITY_ZOOM,
        // Vue 2D stricte : pas d'inclinaison possible (pitch verrouillé à 0)
        // => frustum minimal, nettement moins de tuiles qu'en vue inclinée.
        pitch: 0,
        bearing: 0,
        maxPitch: 0,
        pitchWithRotate: false,
        touchPitch: false,
        // Perf : ne pas re-télécharger les tuiles expirées et afficher les
        // nouvelles tuiles immédiatement (pas de fondu) => scroll plus réactif
        refreshExpiredTiles: false,
        fadeDuration: 0,
        // Depuis MapLibre v5, l'antialiasing se règle via canvasContextAttributes
        canvasContextAttributes: {
          antialias: true,
          // Force le GPU dédié sur les machines double-GPU (laptops)
          powerPreference: "high-performance",
        },
        // Perf : cache de tuiles plus grand => moins de re-téléchargements
        // quand l'utilisateur revient sur une zone déjà visitée ou dézoome.
        maxTileCacheSize: 2048,
        maxTileCacheZoomLevels: 10,
        // Perf : le style MapTiler est fiable, inutile de le re-valider à
        // chaque init (économise le parsing/validation du style JSON).
        validateStyle: false,
        // NB : pas de maxBounds — borner la caméra cachait le point bleu de
        // géolocalisation et clampait fitBounds/flyToZone pour tout
        // utilisateur situé hors de la zone.
      })
    } catch (err: any) {
      console.error("[Map] Erreur d'initialisation:", err)
      setMapError(err.message || "Impossible de charger la carte")
      return
    }

    map.addControl(new maplibregl.NavigationControl(), "top-right")
    map.addControl(new maplibregl.ScaleControl(), "bottom-left")

    // Fournit une image transparente pour les icônes absentes du sprite
    // MapTiler (ex: "office_11", "atm_11") au lieu de spammer la console.
    // Deux mécanismes complémentaires : le résolveur (MapLibre récent) et
    // l'événement styleimagemissing (toutes versions).
    if (typeof (map as any).setMissingStyleImageResolver === "function") {
      ;(map as any).setMissingStyleImageResolver(() => new ImageData(1, 1))
    }
    map.on("styleimagemissing", (e: any) => {
      const id = e?.id
      if (!id || map.hasImage(id)) return
      try {
        map.addImage(id, new ImageData(1, 1))
      } catch {
        // Image déjà ajoutée entre-temps : on ignore
      }
    })

    map.on("error", (e: any) => {
      const msg = e.error?.message || e.message || ""
      // Les icônes de sprite manquantes sont déjà neutralisées ci-dessus
      if (typeof msg === "string" && msg.includes("could not be loaded")) return
      console.error("[Map] Erreur:", e.error?.message || e.message || e)
    })

    map.on("load", () => {
      setMapReady(true)
      try {
        // Icône flèche (►) dessinée sur canvas — utilisée par la couche
        // "route-arrows" pour indiquer la direction à suivre le long du tracé
        if (!map.hasImage("route-arrow")) {
          const s = 64
          const c = document.createElement("canvas")
          c.width = s
          c.height = s
          const ctx = c.getContext("2d")!
          ctx.translate(s / 2, s / 2)
          ctx.beginPath()
          ctx.moveTo(20, 0)
          ctx.lineTo(-14, -16)
          ctx.lineTo(-6, 0)
          ctx.lineTo(-14, 16)
          ctx.closePath()
          ctx.fillStyle = "#1d4ed8"
          ctx.fill()
          ctx.lineWidth = 4
          ctx.strokeStyle = "#ffffff"
          ctx.stroke()
          map.addImage("route-arrow", ctx.getImageData(0, 0, s, s))
        }
      } catch (e: any) {
        console.warn("[Map] Icône route-arrow non créée:", e?.message || e)
      }
    })

    mapRef.current = map
    // Exposé pour faciliter le diagnostic (console navigateur / tests CDP)
    if (typeof window !== "undefined") (window as any).__nestfindMap = map

    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // ── Ma position : point bleu pulsant sur la carte ──
  const showUserMarker = useCallback((posOverride?: [number, number], accuracyOverride?: number | null) => {
    const map = mapRef.current
    const pos = posOverride ?? userPosRef.current
    if (!map || !pos) return

    routeOriginMarkerRef.current?.remove()
    routeOriginMarkerRef.current = null

    const accuracy = accuracyOverride ?? userAccuracyRef.current
    const accuracyLabel = formatAccuracyM(accuracy)
    const title = accuracyLabel ? `Ma position (${accuracyLabel})` : "Ma position"

    if (!userMarkerRef.current) {
      // Injecte l'animation CSS une seule fois dans le <head>
      if (!document.getElementById("nestfind-map-styles")) {
        const style = document.createElement("style")
        style.id = "nestfind-map-styles"
        style.textContent = `
          @keyframes nestfind-pulse {
            0%   { transform: scale(0.85); opacity: 0.9; }
            70%  { transform: scale(2.5);  opacity: 0;   }
            100% { transform: scale(2.5);  opacity: 0;   }
          }
        `
        document.head.appendChild(style)
      }

      const wrapper = document.createElement("div")
      wrapper.style.cssText = "width: 22px; height: 22px; position: relative; pointer-events: none;"
      wrapper.title = title

      // Anneau pulsant
      const pulse = document.createElement("div")
      pulse.style.cssText = `
        position: absolute; inset: -6px;
        background: rgba(37, 99, 235, 0.28);
        border-radius: 50%;
        animation: nestfind-pulse 2s ease-out infinite;
      `

      // Point bleu central
      const dot = document.createElement("div")
      dot.style.cssText = `
        position: absolute; inset: 0;
        background: #2563eb;
        border: 3px solid #ffffff;
        border-radius: 50%;
        box-shadow: 0 2px 6px rgba(0,0,0,0.35);
      `

      wrapper.appendChild(pulse)
      wrapper.appendChild(dot)

      userMarkerRef.current = new maplibregl.Marker({ element: wrapper })
        .setLngLat(pos)
        .addTo(map)
    } else {
      userMarkerRef.current.setLngLat(pos)
      userMarkerRef.current.getElement().title = title
    }
  }, [])

  const showRouteOriginMarker = useCallback((pos: [number, number]) => {
    const map = mapRef.current
    if (!map || userPosRef.current) return

    if (!routeOriginMarkerRef.current) {
      const el = document.createElement("div")
      el.style.cssText = `
        width: 18px;
        height: 18px;
        background: #78716c;
        border: 3px solid #ffffff;
        border-radius: 50%;
        box-shadow: 0 2px 6px rgba(0,0,0,0.35);
      `
      el.title = "Origine approximative (centre de la carte)"
      routeOriginMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat(pos)
        .addTo(map)
    } else {
      routeOriginMarkerRef.current.setLngLat(pos)
    }
  }, [])

  // Définit la position de l'utilisateur (appelée par le parent, ex: recherche par zone)
  const setUserPosition = useCallback((lon: number, lat: number, accuracy?: number | null) => {
    userPosRef.current = [lon, lat]
    userAccuracyRef.current = accuracy ?? null
    const map = mapRef.current
    if (map?.isStyleLoaded()) showUserMarker()
    else map?.once("load", () => showUserMarker())
  }, [showUserMarker])

  const locateUser = useCallback((forceCenter = false) => {
    setGeoLocating(true)
    const applyPosition = (pos: BrowserGeoPosition) => {
      // Garde-fou de vraisemblance : le navigateur (PC sans GPS) estime la
      // position par Wi-Fi/fausse triangulation et peut se tromper de 200 km
      // (ex : Yaoundé → Douala). Une position trop loin du catalogue ne doit
      // NI déplacer la caméra NI afficher un faux point bleu. Si une position
      // précise arrive ensuite (watchPosition continue), elle sera acceptée.
      if (!isLocationPlausible(pos.lat, pos.lon)) {
        const farKm = Math.round(distanceToCatalogKm(pos.lat, pos.lon))
        setGeoError(
          `Position détectée peu fiable (${farKm} km de la zone de recherche : Yaoundé). ` +
          "Votre navigateur n'a pas de GPS précis. Activez le positionnement exact ou utilisez la recherche par quartier."
        )
        return
      }
      setGeoError(null)
      userPosRef.current = [pos.lon, pos.lat]
      userAccuracyRef.current = pos.accuracy

      const renderPosition = () => {
        showUserMarker()
        const map = mapRef.current
        if (!map) return
        const point: [number, number] = [pos.lon, pos.lat]
        const shouldCenter = forceCenter || (!autoCenteredOnUserRef.current && !map.getBounds().contains(point))
        if (shouldCenter) {
          autoCenteredOnUserRef.current = true
          map.flyTo({
            center: point,
            zoom: Math.max(map.getZoom(), 14),
            duration: 900,
            essential: true,
          })
        } else {
          autoCenteredOnUserRef.current = true
        }
      }

      const map = mapRef.current
      if (map?.isStyleLoaded()) renderPosition()
      else if (map) map.once("load", renderPosition)
    }

    return getPreciseBrowserPosition({
      timeoutMs: 15000,
      desiredAccuracyM: 80,
      onUpdate: applyPosition,
    })
      .then(applyPosition)
      .catch(() => setGeoError("Position indisponible — autorisez la localisation"))
      .finally(() => setGeoLocating(false))
  }, [showUserMarker])

  // Expose flyTo + autoFit control to parent via onMapActions callback
  useEffect(() => {
    if (onMapActions) {
      onMapActions({
        flyToProperty,
        flyToZone,
        getUserPosition: () => userPosRef.current,
        setUserPosition,
        setSuppressAutoFit: (v: boolean) => { suppressNextAutoFitRef.current = v },
      })
    }
  }, [flyToProperty, flyToZone, setUserPosition, onMapActions])

  // Remonte les infos d'itinéraire (km/min) au composant parent
  useEffect(() => {
    onRouteInfo?.(routeInfo, routeLoading)
  }, [routeInfo, routeLoading, onRouteInfo])

  // Récupère la position de l'utilisateur dès que possible
  useEffect(() => {
    if (geoStartedRef.current) return
    geoStartedRef.current = true
    void locateUser(false)
  }, [locateUser])

  // ── Itinéraire : tracé + flèches de direction vers le bien sélectionné ──
  const clearRoute = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    for (const id of ["route-arrows", "route-line", "route-casing"]) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
    if (map.getSource("route")) map.removeSource("route")
    routeOriginMarkerRef.current?.remove()
    routeOriginMarkerRef.current = null
    setRouteInfo(null)
  }, [])

  const drawRoute = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    clearRoute()

    const dLng = Number(destination?.longitude)
    const dLat = Number(destination?.latitude)
    if (!destination || isNaN(dLng) || isNaN(dLat)) return

    // Origine : position GPS si connue. Sinon on retente rapidement la
    // géoloc (elle a pu échouer au montage : permission pas encore donnée,
    // délai dépassé...), puis repli sur le centre actuel de la carte.
    if (!userPosRef.current) {
      try {
        const pos = await getPreciseBrowserPosition({ timeoutMs: 7000, desiredAccuracyM: 100 })
        userPosRef.current = [pos.lon, pos.lat]
        userAccuracyRef.current = pos.accuracy
      } catch {}
    }
    const origin: [number, number] = userPosRef.current ?? [
      map.getCenter().lng,
      map.getCenter().lat,
    ]
    if (userPosRef.current) showUserMarker()
    else showRouteOriginMarker(origin)
    const dest: [number, number] = [dLng, dLat]

    setRouteLoading(true)
    let coords: [number, number][] = []
    let km: number | null = null
    let min: number | null = null
    try {
      // API publique OSRM (itinéraire routier) — pas de clé requise.
      // Timeout 8s : si le service est lent/injoignable on trace une ligne
      // droite plutôt que de laisser l'utilisateur attendre.
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${origin[0]},${origin[1]};${dest[0]},${dest[1]}?overview=full&geometries=geojson`,
        { signal: ctrl.signal }
      )
      clearTimeout(timer)
      const json = await res.json()
      const r = json?.routes?.[0]
      if (r?.geometry?.coordinates?.length) {
        coords = r.geometry.coordinates
        km = r.distance / 1000
        min = r.duration / 60
      }
    } catch {}
    // Repli : ligne droite si le service d'itinéraire est indisponible
    if (!coords.length) coords = [origin, dest]
    setRouteLoading(false)

    // La destination peut avoir changé pendant le fetch
    if (!map.getCanvas()) return

    map.addSource("route", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords },
      },
    })

    const labelLayerId = map
      .getStyle()
      ?.layers?.find((l: any) => l.type === "symbol" && l.layout?.["text-field"])?.id

    map.addLayer(
      {
        id: "route-casing",
        type: "line",
        source: "route",
        paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.95 },
        layout: { "line-cap": "round", "line-join": "round" },
      },
      labelLayerId
    )
    map.addLayer(
      {
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": "#16a34a", "line-width": 6 },
        layout: { "line-cap": "round", "line-join": "round" },
      },
      labelLayerId
    )
    // Flèches ► espacées le long du tracé, orientées vers la destination
    map.addLayer(
      {
        id: "route-arrows",
        type: "symbol",
        source: "route",
        minzoom: 8,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 90,
          "icon-image": "route-arrow",
          "icon-size": 0.55,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
        },
      },
      labelLayerId
    )

    setRouteInfo(km != null && min != null ? { km, min } : null)

    const b = new maplibregl.LngLatBounds()
    b.extend(origin)
    b.extend(dest)
    coords.forEach((c) => b.extend(c))
    map.fitBounds(b, {
      padding: { top: 140, bottom: 160, left: 140, right: 140 },
      duration: 900,
    })

    // Destination pin marker (red pin icon)
    destMarkerRef.current?.remove()
    const destEl = document.createElement("div")
    destEl.innerHTML = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 3px 4px rgba(0,0,0,0.4));">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z" fill="#dc2626" stroke="white" stroke-width="1.5"/>
    </svg>`
    destEl.style.cssText = "cursor: pointer; pointer-events: auto;"
    destEl.addEventListener("click", () => {
      if (destination && onViewProperty) {
        const id = destination.ad_id || destination.id
        if (id) onViewProperty(id)
      }
    })
    destMarkerRef.current = new maplibregl.Marker({ element: destEl, anchor: "bottom" })
      .setLngLat(dest)
      .addTo(map)
  }, [destination, clearRoute, onViewProperty, showUserMarker, showRouteOriginMarker])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // `loaded()` est false pendant un flyTo/zoom (tuiles en cours) et "load"
    // ne se déclenche qu'UNE fois à l'init : l'itinéraire ne se traçait plus.
    // `isStyleLoaded()` reste vrai dès que le style est prêt (addSource/addLayer OK).
    if (map.isStyleLoaded()) drawRoute()
    else map.once("load", drawRoute)
  }, [drawRoute])

  // Update markers when properties change
  const updateMarkers = useCallback(() => {
    if (!mapRef.current) return

    const validProps = properties.filter(
      (p) => p.latitude != null && p.longitude != null
    )

    // Garde anti-recréation : si le jeu de biens est identique (mêmes ids et
    // prix), on ne reconstruit NI les marqueurs NI la caméra. Sans ça, un
    // simple re-render du parent recréait les marqueurs DOM et relançait
    // un fitBounds/flyTo — c'était la cause principale des freezes.
    const sig = validProps.map((p) => `${p.ad_id || p.id}:${p.price}`).join("|")
    if (sig === markersSigRef.current) {
      suppressNextAutoFitRef.current = false
      return
    }
    markersSigRef.current = sig

    // Clear old markers
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    if (validProps.length === 0) return

    // Couleur de toiture par type de bien : chaque type de logement est
    // identifiable d'un coup d'œil sur la carte.
    const ROOF_COLORS: Record<string, string> = {
      maison: "#dc2626",
      villa: "#9333ea",
      appartement: "#2563eb",
      studio: "#d97706",
      chambre: "#0d9488",
      terrain: "#16a34a",
      bureau: "#64748b",
    }
    const roofColor = (t?: string | null) =>
      ROOF_COLORS[(t || "").toLowerCase()] || "#ea580c"

    // Classes CSS des marqueurs maison (injectées une seule fois)
    if (!document.getElementById("nestfind-pin-styles")) {
      const style = document.createElement("style")
      style.id = "nestfind-pin-styles"
      style.textContent = `
        .nestfind-pin-inner { position: relative; transition: transform 0.15s ease; transform-origin: 50% 100%; }
        .nestfind-pin-inner:hover { transform: scale(1.18); }
        .nestfind-pin-inner .np-price {
          position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
          background: rgba(26,26,26,0.95); color: #fff; padding: 4px 10px; border-radius: 16px;
          font-size: 11px; font-weight: 700; white-space: nowrap; border: 2px solid #fff;
          box-shadow: 0 3px 8px rgba(0,0,0,0.35); opacity: 0; pointer-events: none;
          transition: opacity 0.15s ease;
        }
        .nestfind-pin-inner:hover .np-price { opacity: 1; }
      `
      document.head.appendChild(style)
    }

    validProps.forEach((prop) => {
      // Marqueur « maison » dessiné en SVG (dessin de maison avec toit coloré
      // selon le type de bien) relié au point GPS par une pointe.
      // IMPORTANT : maplibre applique `transform: translate(...)` sur l'élément
      // racine du marker pour le positionner (anchor "bottom" = la pointe).
      // On n'anime jamais transform sur le wrapper — le zoom au survol se fait
      // sur le conteneur interne (.nestfind-pin-inner), sinon le pin "fuit".
      const color = roofColor(prop.property_type)
      const priceLabel = prop.price
        ? `${(prop.price / 1000).toFixed(0)}k FCFA`
        : "Voir"

      const wrapper = document.createElement("div")
      // will-change:transform indique au navigateur que maplibre repositionne
      // cet élément à chaque frame => pin promu sur son propre layer GPU.
      wrapper.style.cssText = "pointer-events: auto; cursor: pointer; will-change: transform;"
      wrapper.title = `${prop.title || "Bien"} — ${priceLabel}`

      const inner = document.createElement("div")
      inner.className = "nestfind-pin-inner"
      inner.innerHTML = `
        <svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true">
          <ellipse cx="15" cy="38.4" rx="5" ry="1.6" fill="rgba(0,0,0,0.25)"/>
          <polygon points="10,29 20,29 15,37.5" fill="#1f2937"/>
          <polygon points="15,1 29,13 1,13" fill="${color}" stroke="#1f2937" stroke-width="1.6" stroke-linejoin="round"/>
          <rect x="4" y="13" width="22" height="15.5" rx="1.4" fill="#ffffff" stroke="#1f2937" stroke-width="1.6"/>
          <rect x="12" y="20.5" width="6" height="8" rx="0.8" fill="${color}"/>
          <rect x="6.5" y="15.5" width="4.5" height="4" rx="0.5" fill="${color}" opacity="0.85"/>
        </svg>
        <div class="np-price">${priceLabel}</div>
      `

      const clickHandler = (ev: Event) => {
        ev.stopPropagation()
        const id = prop.ad_id || prop.id || ""
        if (id && onMarkerClick) onMarkerClick(id)
        // Zoom vers le bien cliqué (la caméra suit le marqueur)
        const map = mapRef.current
        if (map && prop.latitude != null && prop.longitude != null) {
          map.flyTo({
            center: [Number(prop.longitude), Number(prop.latitude)],
            zoom: 16,
            duration: 800,
            essential: true,
          })
        }
      }
      inner.addEventListener("click", clickHandler)
      // Stacking context : au survol, le pin dépasse les pins voisins
      inner.addEventListener("mouseenter", () => { wrapper.style.zIndex = "1000" })
      inner.addEventListener("mouseleave", () => { wrapper.style.zIndex = "" })

      wrapper.appendChild(inner)
      const el = wrapper

      // NB : on ne crée PAS de maplibregl.Popup par marqueur — le clic est
      // intercepté (stopPropagation) et le détail s'affiche dans la card
      // overlay du parent. Créer ~120 popups jamais ouverts coûtait cher.

      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([prop.longitude!, prop.latitude!])
        .addTo(mapRef.current!)

      markersRef.current.push(marker)
    })

    const map = mapRef.current

    // Après une recherche, la carte doit cadrer TOUS les résultats : zoom ou
    // dézoom pour que chaque bien soit visible à l'écran (demande utilisateur).
    const focusProps = validProps

    const focusBounds = new maplibregl.LngLatBounds()
    focusProps.forEach((p) => focusBounds.extend([p.longitude!, p.latitude!]))

    // Si un suppressAutoFit est actif (ex: après zone search GPS), on ne
    // re-cible pas la carte afin que flyToZone conserve la vue courante.
    if (suppressNextAutoFitRef.current) {
      suppressNextAutoFitRef.current = false
    } else if (focusProps.length > 1) {
      map.fitBounds(focusBounds, {
        padding: 90,
        maxZoom: 16,
      })
    } else {
      map.flyTo({
        center: [focusProps[0].longitude!, focusProps[0].latitude!],
        zoom: 15,
      })
    }
  }, [properties, onMarkerClick])

  useEffect(() => {
    if (mapRef.current) {
      if (mapRef.current.isStyleLoaded()) {
        updateMarkers()
      } else {
        mapRef.current.once("load", updateMarkers)
      }
    }
  }, [updateMarkers])

  return (
    <>
      <div
        ref={mapContainer}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          background: "#e5e7eb",
        }}
      />

      <button
        type="button"
        onClick={() => void locateUser(true)}
        disabled={geoLocating}
        className="absolute bottom-5 right-4 z-20 flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-2 text-xs font-semibold text-stone-700 shadow-lg backdrop-blur transition-colors hover:bg-white disabled:opacity-60"
        title="Centrer la carte sur ma position"
      >
        <LocateFixed className="w-4 h-4" />
        {geoLocating ? "Localisation..." : "Ma position"}
      </button>

      {geoError && (
        <div className="absolute bottom-5 left-4 z-20 rounded-full bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 shadow-lg border border-amber-200">
          {geoError}
        </div>
      )}

      {mapError && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f5f5f4",
          zIndex: 1,
        }}>
          <div style={{ textAlign: "center", padding: "2rem" }}>
            <p style={{ fontSize: "14px", fontWeight: 600, color: "#57534e", marginBottom: "4px" }}>
              Carte indisponible
            </p>
            <p style={{ fontSize: "12px", color: "#a8a29e" }}>
              {mapError}
            </p>
          </div>
        </div>
      )}
      {!mapReady && !mapError && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f5f5f4",
          zIndex: 1,
        }}>
          <div style={{ textAlign: "center" }}>
            <div className="animate-spin" style={{
              width: "32px",
              height: "32px",
              border: "3px solid #d6d3d1",
              borderTopColor: "#1c1917",
              borderRadius: "50%",
              margin: "0 auto 8px",
            }} />
            <p style={{ fontSize: "12px", color: "#78716c" }}>Chargement de la carte...</p>
          </div>
        </div>
      )}
    </>
  )
}
