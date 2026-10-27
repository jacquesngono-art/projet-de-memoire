// Use relative /api in production (Vercel rewrites proxy to VPS), localhost in dev
const API_URL = process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:5001/api")

// En production, on force le même domaine : les rewrites Vercel proxifient
// /socket.io vers le VPS. Pointer vers une autre URL absolue (ex: un ancien
// déploiement Vercel) déclenche un blocage CORS, car ce domaine ne renvoie pas
// les en-têtes Access-Control-Allow-Origin du backend.
export const SOCKET_URL =
  process.env.NODE_ENV === "production"
    ? ""
    : process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:5001"

// === JWT ===
export function getToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("immo_token")
}

// Événement global de changement d'état d'authentification : permet aux
// composants montés (ex : FAB assistant IA) de se synchroniser immédiatement
// après login/logout sans recharger la page.
export const AUTH_EVENT = "immo_auth_changed"

export function saveToken(token: string) {
  if (typeof window === "undefined") return
  localStorage.setItem("immo_token", token)
  window.dispatchEvent(new Event(AUTH_EVENT))
}

export function removeToken() {
  if (typeof window === "undefined") return
  localStorage.removeItem("immo_token")
  window.dispatchEvent(new Event(AUTH_EVENT))
}

export function getUser(): any | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem("immo_user")
  return raw ? JSON.parse(raw) : null
}

export function saveUser(user: any) {
  if (typeof window === "undefined") return
  localStorage.setItem("immo_user", JSON.stringify(user))
}

export function clearAuth() {
  removeToken()
  if (typeof window !== "undefined") localStorage.removeItem("immo_user")
}

// === Fetch wrapper ===
export async function apiFetch(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  }
  const token = getToken()
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`${API_URL}${path}`, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    // Token expiré ou invalide : on purge les credentials locaux pour ne pas
    // rejouer la même requête 401 (badges, profil, socket…) en boucle.
    if (res.status === 401 && token) clearAuth()
    throw new Error(err.error || err.message || `Erreur ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

// === AUTH ===
export async function login(email: string, password: string) {
  const json = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })
  if (json.data?.token) {
    saveToken(json.data.token)
    if (json.data.user) saveUser(json.data.user)
  }
  return json
}

export async function register(data: any) {
  const json = await apiFetch("/auth/register", { method: "POST", body: JSON.stringify(data) })
  if (json.data?.token) {
    saveToken(json.data.token)
    if (json.data.user) saveUser(json.data.user)
  }
  return json
}

export async function getProfile() {
  return apiFetch("/auth/profile")
}

export async function updateProfile(data: any) {
  const json = await apiFetch("/auth/profile", { method: "PUT", body: JSON.stringify(data) })
  // Rafraîchit le user en localStorage — la photo/nom de l'onboarding sont
  // ensuite visibles partout (header, profil…) sans re-login.
  if (json.data) saveUser(json.data)
  return json
}

export async function updatePreferences(data: any) {
  const json = await apiFetch("/auth/preferences", { method: "PUT", body: JSON.stringify(data) })
  if (json.data) saveUser(json.data)
  return json
}

// === ANNONCES ===
export async function getAds(params: Record<string, string | number | undefined> = {}) {
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") sp.append(k, String(v))
  })
  const q = sp.toString() ? `?${sp.toString()}` : ""
  return apiFetch(`/annonces${q}`)
}

export async function getAdDetail(id: string) {
  return apiFetch(`/annonces/${id}`)
}

export async function createAd(data: any) {
  return apiFetch("/annonces", { method: "POST", body: JSON.stringify(data) })
}

export async function deleteAd(id: string) {
  return apiFetch(`/annonces/${id}`, { method: "DELETE" })
}

export async function listMyAds() {
  return apiFetch("/annonces/me/mes-annonces")
}

export async function contactAd(id: string) {
  return apiFetch(`/annonces/${id}/contacter`, { method: "POST" })
}

// === PRÉFÉRENCES DE PROXIMITÉ ===
export async function listPreferences() {
  return apiFetch("/preferences")
}

// Détection automatique : géocodage inversé (vrai quartier/ville) +
// équipements proches détectés (Overpass) pour un point posé sur la map
export async function detectProximity(lat: number, lon: number) {
  return apiFetch(`/proximite?lat=${lat}&lon=${lon}`)
}

// Géocodage direct : nom de quartier/adresse/ville → coordonnées (pin auto)
export async function geocodePlace(q: string) {
  return apiFetch(`/proximite/geocode?q=${encodeURIComponent(q)}`)
}

// === FAVORIS ===
export async function listFavorites() {
  return apiFetch("/favoris")
}

export async function addFavorite(adId: string) {
  return apiFetch("/favoris", { method: "POST", body: JSON.stringify({ adId }) })
}

export async function removeFavorite(adId: string) {
  return apiFetch(`/favoris/${adId}`, { method: "DELETE" })
}

export async function checkFavorite(adId: string) {
  return apiFetch(`/favoris/${adId}`)
}

// === CRITERES ===
export async function listCriteria() {
  return apiFetch("/criteres")
}

export async function updateCriteria(criteres: any[]) {
  return apiFetch("/criteres", { method: "PUT", body: JSON.stringify({ criteres }) })
}

export async function clearCriteria() {
  return apiFetch("/criteres", { method: "DELETE" })
}

// === NOTIFICATIONS ===
export async function listNotifications() {
  return apiFetch("/notifications")
}

export async function countUnreadNotifications() {
  return apiFetch("/notifications/unread/count")
}

export async function markNotificationRead(id: string) {
  return apiFetch(`/notifications/${id}/read`, { method: "PUT" })
}

export async function markAllNotificationsRead() {
  return apiFetch("/notifications/read/all", { method: "PUT" })
}

// === CHAT ===
export async function listConversations() {
  return apiFetch("/chat/conversations")
}

export async function openConversation(targetUserId: string) {
  return apiFetch("/chat/conversations", { method: "POST", body: JSON.stringify({ targetUserId }) })
}

// Recherche d'utilisateurs pour démarrer une conversation (même sans annonce)
export async function searchUsers(q: string) {
  return apiFetch(`/chat/users/search?q=${encodeURIComponent(q)}`)
}

export async function getMessages(conversationId: string) {
  return apiFetch(`/chat/conversations/${conversationId}/messages`)
}

export async function sendMessage(
  conversationId: string,
  content: string,
  attachment?: { url: string; type: string; name?: string }
) {
  return apiFetch(`/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, attachment }),
  })
}

export async function countUnreadMessages() {
  return apiFetch("/chat/unread/count")
}

// === APPELS AUDIO/VIDÉO (LiveKit) ===
export async function startCall(conversationId: string, video: boolean) {
  return apiFetch(`/chat/conversations/${conversationId}/call`, {
    method: "POST",
    body: JSON.stringify({ video }),
  })
}

export async function joinCall(conversationId: string) {
  return apiFetch(`/chat/conversations/${conversationId}/call/join`, { method: "POST" })
}

export async function endCall(conversationId: string, reason = "ended") {
  return apiFetch(`/chat/conversations/${conversationId}/call/end`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  })
}

// === AGENT IA ===
export async function agentSearch(message: string) {
  return apiFetch("/agent/search", { method: "POST", body: JSON.stringify({ message }) })
}

export async function getRecommendations() {
  return apiFetch("/agent/recommendations")
}

export async function estimatePrice(data: any) {
  return apiFetch("/agent/estimate-price", { method: "POST", body: JSON.stringify(data) })
}

export async function generateDescription(data: any) {
  return apiFetch("/agent/description", { method: "POST", body: JSON.stringify(data) })
}

// Analyse d'image avec vision IA (Pixtral) — upload de fichiers
export async function analyzeImageFiles(files: File[], prompt?: string) {
  const formData = new FormData()
  files.forEach((f) => formData.append("images", f))
  if (prompt) formData.append("prompt", prompt)

  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`${API_URL}/agent/analyze-image`, {
    method: "POST",
    headers,
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || err.message || `Erreur ${res.status}`)
  }
  return res.json()
}

// Analyse d'image avec vision IA — URLs
export async function analyzeImageUrls(urls: string[], prompt?: string) {
  return apiFetch("/agent/analyze-image", {
    method: "POST",
    body: JSON.stringify({ images: urls, prompt }),
  })
}

// Extraction de caractéristiques immobilières depuis une image
export async function extractPropertyFeatures(files: File[]) {
  const formData = new FormData()
  files.forEach((f) => formData.append("images", f))

  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`${API_URL}/agent/extract-features`, {
    method: "POST",
    headers,
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || err.message || `Erreur ${res.status}`)
  }
  return res.json()
}

// === ADMIN ===
export async function adminListPendingAds() {
  return apiFetch("/admin/ads/pending")
}

export async function adminValidateAd(id: string) {
  return apiFetch(`/admin/ads/${id}/validate`, { method: "PUT" })
}

export async function adminRejectAd(id: string) {
  return apiFetch(`/admin/ads/${id}/reject`, { method: "PUT" })
}

export async function adminListUsers() {
  return apiFetch("/admin/users")
}

export async function adminUpdateUserStatus(id: string, status: string) {
  return apiFetch(`/admin/users/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) })
}

export async function adminDeleteUser(id: string) {
  return apiFetch(`/admin/users/${id}`, { method: "DELETE" })
}

export async function adminStats() {
  return apiFetch("/admin/stats")
}
