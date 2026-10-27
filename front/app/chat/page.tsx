"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, MessageSquareDashed, LayoutDashboard, Mic } from "lucide-react"
import { AIChatOrb } from "@/components/ai-chat-orb"
import { AIChatTypingIndicator } from "@/components/ai-chat-typing"
import { AIChatComposer, type AIModel } from "@/components/ai-chat-composer"
import { getUser, getProfile } from "@/lib/api"
import { cn } from "@/lib/utils"
import { AIVoiceConversation } from "@/components/ai-voice-conversation"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api"

// Strip markdown formatting from text
function stripMarkdown(text: string): string {
  return text
    // Remove bold **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    // Remove italic *text* or _text_
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    // Remove inline code `text`
    .replace(/`(.+?)`/g, "$1")
    // Remove headers ### text
    .replace(/^#{1,6}\s+/gm, "")
    // Remove bullet points - / * +
    .replace(/^[\s]*[-*+]\s+/gm, "")
    // Remove numbered lists 1. 2. etc
    .replace(/^\d+\.\s+/gm, "")
    // Remove links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove images ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // Remove horizontal rules ---
    .replace(/^---+$/gm, "")
    // Remove blockquotes >
    .replace(/^>\s+/gm, "")
    // Collapse multiple newlines
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  results?: any[]
  image?: string
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export default function AIChatPage() {
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Bonjour ! Je suis votre assistant immobilier. Décrivez-moi le bien que vous recherchez au Cameroun, ou envoyez une photo de bien pour que je l'analyse.",
    },
  ])
  const [loading, setLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState<AIModel>("mistral/codestral-latest")
  const abortRef = useRef<AbortController | null>(null)

  // Photo de profil de l'utilisateur connecté : réutilisée comme avatar de ses
  // messages dans le chat IA (à la place de la simple lettre initiale).
  const [userPhoto, setUserPhoto] = useState<string | null>(null)
  const [userInitial, setUserInitial] = useState("V")
  const [aiVoiceOpen, setAiVoiceOpen] = useState(false)

  useEffect(() => {
    // 1. Source rapide : l'objet gardé en localStorage à la connexion.
    const u = getUser()
    let initial = ""
    if (u?.profile_photo_url) setUserPhoto(u.profile_photo_url)
    const name = [u?.first_name, u?.last_name].find(Boolean)
    initial = (name || "").trim().charAt(0).toUpperCase()
    if (initial) setUserInitial(initial)

    // 2. Source fiable : recharger le profil depuis l'API. L'objet en
    //    localStorage peut être périmé (photo ajoutée/changée après la
    //    dernière connexion) — c'est ce qui faisait retomber l'avatar sur
    //    l'initiale dans le chat IA.
    getProfile()
      .then((json: any) => {
        const data = json?.data || json
        if (data?.profile_photo_url) setUserPhoto(data.profile_photo_url)
        const pName = [data?.first_name, data?.last_name].find(Boolean)
        const pInitial = (pName || "").trim().charAt(0).toUpperCase()
        if (pInitial) setUserInitial(pInitial)
      })
      .catch(() => {}) // non connecté ou API indisponible : on garde getUser()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])

  const sendMessage = useCallback(async (content: string, imageData?: string) => {
    if ((!content.trim() && !imageData) || loading) return
    const userText = content.trim() || "Décrivez cette image"

    const userMsg: Message = { id: generateId(), role: "user", content: userText, image: imageData }
    const assistantMsg: Message = { id: generateId(), role: "assistant", content: "" }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setLoading(true)

    abortRef.current = new AbortController()

    try {
      let data: any

      if (imageData) {
        // Mode vision : analyser l'image et chercher des biens similaires en base
        const res = await fetch(`${API_URL}/agent/search-by-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ images: [imageData], prompt: userText }),
          signal: abortRef.current.signal,
        })
        const json = await res.json()
        data = json.data || json
        // La réponse contient response (texte) + results (biens trouvés)
      } else {
        // Mode recherche classique
        const res = await fetch(`${API_URL}/agent/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: userText }),
          signal: abortRef.current.signal,
        })
        const json = await res.json()
        data = json.data || json
      }

      setMessages(prev =>
        prev.map(msg =>
          msg.id === assistantMsg.id
            ? {
                ...msg,
                content: stripMarkdown(data.response || "Je n'ai pas trouvé de réponse. Pouvez-vous reformuler ?"),
                results: data.results || [],
              }
            : msg
        )
      )
    } catch (err: any) {
      if (err.name === "AbortError") {
        setMessages(prev => prev.map(msg => (msg.id === assistantMsg.id ? { ...msg, content: "[Annulé]" } : msg)))
      } else {
        setMessages(prev =>
          prev.map(msg =>
            msg.id === assistantMsg.id
              ? { ...msg, content: "Une erreur est survenue. Vérifiez que le backend est démarré sur le port 5001." }
              : msg
          )
        )
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [loading])

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearChat = useCallback(() => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: "Bonjour ! Je suis votre assistant immobilier. Décrivez-moi le bien que vous recherchez au Cameroun, ou envoyez une photo de bien pour que je l'analyse.",
      },
    ])
  }, [])

  return (
    <div className="flex flex-col h-screen bg-stone-50 relative">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-stone-200 px-6 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/dashboard")} className="p-2 rounded-full hover:bg-stone-100 transition-colors" title="Retour au tableau de bord">
              <LayoutDashboard className="w-5 h-5 text-stone-600" />
            </button>
            <AIChatOrb size={40} />
            <div>
              <h1 className="font-semibold text-foreground">Assistant IA</h1>
              <p className="text-xs text-muted-foreground">Agent immobilier virtuel</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAiVoiceOpen(true)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors shadow-sm"
              )}
              aria-label="Conversation vocale"
              title="Conversation vocale avec l'assistant"
            >
              <Mic className="w-4 h-4" />
              <span className="hidden sm:inline">Vocal</span>
            </button>
            <button
              onClick={clearChat}
              className="p-2 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 transition-colors"
              aria-label="Reset chat"
            >
              <MessageSquareDashed className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 pb-44 pt-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-stone-400">
              <div className="mb-4">
                <AIChatOrb size={128} />
              </div>
              <p className="text-lg font-medium text-gray-500">Bonjour, je suis votre assistant</p>
              <p className="text-sm mt-1 text-gray-400">Envoyez un message pour commencer votre recherche immobilière</p>
            </div>
          )}

          {messages.map((msg) => {
            // Skip empty assistant message while loading (typing indicator handles it)
            if (msg.role === "assistant" && !msg.content && loading) return null
            return (
            <div
              key={msg.id}
              className={cn(
                "flex gap-3 anim-fade-up",
                msg.role === "user" ? "flex-row-reverse" : "flex-row"
              )}
            >
              {msg.role === "assistant" ? (
                <AIChatOrb size={36} />
              ) : userPhoto ? (
                <img
                  src={userPhoto}
                  alt="Votre photo de profil"
                  className="w-9 h-9 rounded-full object-cover border border-stone-200 shadow-sm shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-foreground flex items-center justify-center text-background text-sm font-bold shrink-0">
                  {userInitial}
                </div>
              )}
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                  msg.role === "user"
                    ? "bg-foreground text-background rounded-br-none"
                    : "bg-white border border-stone-200 text-stone-700 rounded-bl-none shadow-sm"
                )}
              >
                {msg.image && (
                  <div className="mb-2 rounded-xl overflow-hidden border border-background/10">
                    <img src={msg.image} alt="Image partagée" className="w-full max-h-60 object-cover" />
                  </div>
                )}
                {msg.content}

                {msg.results && msg.results.length > 0 && (
                  <div className="grid gap-3 mt-4">
                    {msg.results.slice(0, 3).map((ad: any) => {
                      const photos = Array.isArray(ad.photos) ? ad.photos.map((p: any) => p?.url || p).filter(Boolean) : []
                      const img = photos[0] || "/images/house-1.jpg"
                      return (
                      <div
                        key={ad.ad_id || ad.id}
                        onClick={() => router.push(`/annonce/${ad.ad_id || ad.id}`)}
                        className="flex gap-3 p-3 rounded-xl bg-stone-50 border border-stone-200 cursor-pointer hover:border-stone-300 transition-colors"
                      >
                        <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0">
                          <img src={img} alt={ad.title} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-foreground truncate">{ad.title || "Annonce"}</p>
                          <p className="text-xs text-stone-500">{ad.city || ad.address || "Cameroun"}</p>
                          <p className="text-sm font-bold text-foreground mt-1">
                            {ad.price?.toLocaleString("fr-FR")} FCFA
                          </p>
                        </div>
                      </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
            )
          })}

          {loading && (
            <div className="flex gap-3 anim-fade-up">
              <AIChatOrb size={36} />
              <div className="bg-white border border-stone-200 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm flex items-center gap-2 min-w-[80px]">
                <AIChatTypingIndicator />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <AIChatComposer
        onSend={sendMessage}
        onStop={stopStreaming}
        isStreaming={loading}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
      />
      <AIVoiceConversation open={aiVoiceOpen} onClose={() => setAiVoiceOpen(false)} />
    </div>
  )
}
