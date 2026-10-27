"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { AIChatOrb } from "@/components/ai-chat-orb"
import { getToken, AUTH_EVENT } from "@/lib/api"

export function AIChatFab() {
  const router = useRouter()
  const pathname = usePathname()
  // L'assistant n'apparaît que pour un utilisateur CONNECTÉ (jamais en
  // overlay sur la landing publique). Authentifié = token JWT présent.
  const [authenticated, setAuthenticated] = useState(false)

  useEffect(() => {
    const sync = () => setAuthenticated(Boolean(getToken()))
    sync()
    // Synchronisation immédiate via l'événement émis par saveToken/clearAuth,
    // et via l'événement "storage" pour les autres onglets/fenêtres.
    window.addEventListener(AUTH_EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(AUTH_EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  // Hide on chat pages et pour les visiteurs non connectés
  if (pathname === "/chat" || pathname === "/messages") return null
  if (!authenticated) return null

  return (
    <button
      onClick={() => router.push("/chat")}
      className="fixed bottom-6 right-6 z-50 group flex items-center gap-2 pl-1 pr-4 py-1 bg-white rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-border hover:scale-105 transition-transform duration-300"
      aria-label="Open AI assistant"
    >
      <AIChatOrb size={44} />
      <span className="text-sm font-semibold text-foreground hidden sm:inline">Assistant IA</span>
    </button>
  )
}
