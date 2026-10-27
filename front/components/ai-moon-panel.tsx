"use client"

import { useEffect, useRef, useState } from "react"
import { X, Mic, MicOff, Send, Sparkles } from "lucide-react"
import { AIChatOrb } from "@/components/ai-chat-orb"
import { agentSearch } from "@/lib/api"
import { cn } from "@/lib/utils"

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

interface AIMoonPanelProps {
  open: boolean
  onClose: () => void
  initialQuery?: string
}

type Status = "idle" | "listening" | "thinking" | "speaking" | "error"

export function AIMoonPanel({ open, onClose, initialQuery = "" }: AIMoonPanelProps) {
  const [status, setStatus] = useState<Status>("idle")
  const [query, setQuery] = useState(initialQuery)
  const [transcript, setTranscript] = useState("")
  const [answer, setAnswer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<any>(null)
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null)
  const hasAutoStartedRef = useRef(false)

  const speak = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setStatus("idle")
      return
    }
    try {
      window.speechSynthesis.cancel()
    } catch {}
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = "fr-FR"
    utter.rate = 1.0
    utter.pitch = 1.0
    utter.volume = 1.0
    utterRef.current = utter
    utter.onstart = () => setStatus("speaking")
    utter.onend = () => setStatus("idle")
    utter.onerror = () => setStatus("idle")
    window.speechSynthesis.speak(utter)
  }

  const startListening = () => {
    if (typeof window === "undefined") return
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError("La recherche vocale n'est pas prise en charge par ce navigateur.")
      setStatus("error")
      return
    }

    try {
      recognitionRef.current?.stop()
    } catch {}

    const recognition = new SpeechRecognition()
    recognition.lang = "fr-FR"
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event: any) => {
      let interim = ""
      let final = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript
        if (event.results[i].isFinal) final += t
        else interim += t
      }
      const text = (final || interim).trim()
      if (text) {
        setTranscript(text)
        setQuery(text)
      }
      if (final && text) {
        try {
          recognition.stop()
        } catch {}
        setStatus("thinking")
        ;(async () => {
          try {
            const json = await agentSearch(text)
            const payload = json.data || json
            const raw = payload.response || null
            const cleaned = raw ? stripMarkdown(raw) : "Voici les résultats correspondants à votre demande."
            setAnswer(cleaned)
            setTranscript("")
            speak(cleaned)
          } catch (e: any) {
            setError(e?.message || "Erreur lors de la recherche IA.")
            setStatus("error")
          }
        })()
      }
    }

    recognition.onerror = () => {
      if (status === "thinking" || status === "speaking") return
      setError("Impossible d'accéder au micro. Vérifiez les autorisations.")
      setStatus("error")
    }

    recognitionRef.current = recognition
    try {
      setTranscript("")
      setError(null)
      setAnswer(null)
      recognition.start()
      setStatus("listening")
    } catch {
      setError("Impossible de démarrer le micro.")
      setStatus("error")
    }
  }

  const stopListening = () => {
    try {
      recognitionRef.current?.stop()
    } catch {}
    if (status === "listening") setStatus("idle")
  }

  const handleSubmit = () => {
    const text = query.trim()
    if (!text) return
    try {
      recognitionRef.current?.stop()
    } catch {}
    setStatus("thinking")
    setTranscript(text)
    setQuery("")
    setAnswer(null)
    setError(null)
    ;(async () => {
      try {
        const json = await agentSearch(text)
        const payload = json.data || json
        const raw = payload.response || null
        const cleaned = raw ? stripMarkdown(raw) : "Voici les résultats correspondants à votre demande."
        setAnswer(cleaned)
        setTranscript("")
        speak(cleaned)
      } catch (e: any) {
        setError(e?.message || "Erreur lors de la recherche IA.")
        setStatus("error")
      }
    })()
  }

  useEffect(() => {
    if (!open) {
      setStatus("idle")
      setQuery(initialQuery || "")
      setTranscript("")
      setAnswer(null)
      setError(null)
      hasAutoStartedRef.current = false
      try {
        recognitionRef.current?.stop()
      } catch {}
      try {
        if (typeof window !== "undefined") window.speechSynthesis?.cancel()
      } catch {}
      return
    }
    setQuery(initialQuery || "")
    setAnswer(null)
    setError(null)
    setTranscript("")
    setStatus("idle")

    if (!hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true
      const t = setTimeout(() => {
        startListening()
      }, 250)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuery])

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop()
      } catch {}
      try {
        if (typeof window !== "undefined") window.speechSynthesis?.cancel()
      } catch {}
    }
  }, [])

  if (!open) return null

  const orbState = status === "error" ? "idle" : status

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-[0_40px_80px_-40px_rgba(15,23,42,0.4)] border border-stone-100 overflow-hidden anim-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-amber-500" />
            <span className="text-sm font-medium text-stone-800">Assistant IA</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-50 transition-colors"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 pt-2 pb-5 flex flex-col items-center text-center">
          <div className="relative">
            <AIChatOrb size={72} active state={orbState as any} />
          </div>
          <div className="mt-3">
            {status === "idle" && !answer && !error && (
              <p className="text-sm text-stone-600">Comment puis-je t'aider ?</p>
            )}
            {status === "listening" && (
              <p className="text-sm text-stone-600">Je t'écoute...</p>
            )}
            {status === "thinking" && (
              <p className="text-sm text-stone-600">Je réfléchis...</p>
            )}
            {status === "speaking" && (
              <p className="text-sm text-stone-600">Je réponds...</p>
            )}
            {status === "error" && error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
          </div>

          {transcript && status === "listening" && (
            <div className="mt-3 max-w-sm">
              <p className="text-sm text-stone-800 leading-relaxed">{transcript}</p>
            </div>
          )}

          {answer && (
            <div className="mt-4 w-full text-left bg-stone-50 rounded-2xl border border-stone-100 px-4 py-3">
              <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">{answer}</p>
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="border-t border-stone-100 px-4 py-3 flex items-center gap-2">
          <button
            onClick={status === "listening" ? stopListening : startListening}
            disabled={status === "thinking" || status === "speaking"}
            className={cn(
              "w-9 h-9 flex items-center justify-center rounded-full transition-colors shrink-0",
              status === "listening"
                ? "bg-red-500 text-white"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200",
              (status === "thinking" || status === "speaking") && "opacity-40 pointer-events-none"
            )}
            title={status === "listening" ? "Arrêter l'écoute" : "Parler"}
          >
            {status === "listening" ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <div className="flex-1 flex items-center bg-stone-50 border border-stone-200 rounded-full px-3 py-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder="Écrivez votre question..."
              className="flex-1 bg-transparent text-sm text-stone-800 placeholder:text-stone-400 outline-none"
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={!query.trim() || status === "thinking" || status === "speaking"}
            className={cn(
              "w-9 h-9 flex items-center justify-center rounded-full transition-colors shrink-0",
              query.trim() && status !== "thinking" && status !== "speaking"
                ? "bg-stone-900 text-white hover:bg-stone-800"
                : "bg-stone-100 text-stone-400"
            )}
            title="Envoyer"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
