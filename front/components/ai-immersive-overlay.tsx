"use client"

import { useEffect, useRef, useState } from "react"
import {
  X,
  Plus,
  Mic,
  MicOff,
  MoreHorizontal,
  Settings,
  Share2,
  Sparkles,
  ArrowUpRight,
} from "lucide-react"
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

interface AIImmersiveOverlayProps {
  open: boolean
  onClose: () => void
  initialQuery?: string
}

type Status = "idle" | "listening" | "thinking" | "speaking" | "error"

export function AIImmersiveOverlay({ open, onClose, initialQuery = "" }: AIImmersiveOverlayProps) {
  const [status, setStatus] = useState<Status>("idle")
  const [query, setQuery] = useState(initialQuery)
  const [transcript, setTranscript] = useState("")
  const [answer, setAnswer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bars, setBars] = useState<number[]>(Array(16).fill(4))

  const recognitionRef = useRef<any>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null)

  const stopAudioViz = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    try {
      sourceRef.current?.disconnect()
    } catch {}
    sourceRef.current = null
    analyserRef.current = null
    try {
      audioCtxRef.current?.close()
    } catch {}
    audioCtxRef.current = null
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    } catch {}
    streamRef.current = null
    setBars(Array(16).fill(4))
  }

  const startAudioViz = async () => {
    stopAudioViz()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      streamRef.current = stream
      const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      if (ctx.state === "suspended") await ctx.resume()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.6
      analyserRef.current = analyser
      const source = ctx.createMediaStreamSource(stream)
      sourceRef.current = source
      source.connect(analyser)

      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const step = Math.max(1, Math.floor(data.length / 16))
        const next = Array.from({ length: 16 }, (_, i) => {
          let sum = 0
          const startIdx = i * step
          for (let j = 0; j < step; j++) {
            sum += data[startIdx + j] || 0
          }
          const avg = sum / step
          const h = 4 + (avg / 255) * 52
          return Math.max(4, Math.min(56, h))
        })
        setBars(next)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch {
      // ignore
    }
  }

  const speak = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setStatus("idle")
      setAnswer(text)
      return
    }
    try {
      window.speechSynthesis.cancel()
    } catch {}
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = "fr-FR"
    utter.rate = 0.98
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
        stopAudioViz()
        setStatus("thinking")
        ;(async () => {
          try {
            const json = await agentSearch(text)
            const payload = json.data || json
            const raw = payload.response || null
            const cleaned = raw ? stripMarkdown(raw) : "Voici les résultats correspondants à votre recherche."
            setAnswer(cleaned)
            setTranscript("")
            speak(cleaned)
          } catch (e: any) {
            setError(e?.message || "Une erreur est survenue lors de la recherche IA.")
            setStatus("error")
          }
        })()
      }
    }

    recognition.onerror = () => {
      if (status === "thinking" || status === "speaking") return
      setError("Impossible d'accéder au micro. Vérifiez les autorisations.")
      setStatus("error")
      stopAudioViz()
    }

    recognition.onend = () => {
      if (status === "listening") {
        // rester en état visuel si pas de résultat
      }
    }

    recognitionRef.current = recognition
    try {
      setTranscript("")
      setError(null)
      startAudioViz()
      recognition.start()
      setStatus("listening")
    } catch {
      setError("Impossible de démarrer le micro.")
      setStatus("error")
      stopAudioViz()
    }
  }

  const handleSubmit = () => {
    const text = query.trim()
    if (!text) return
    try {
      recognitionRef.current?.stop()
    } catch {}
    stopAudioViz()
    setStatus("thinking")
    setTranscript(text)
    setQuery("")
    ;(async () => {
      try {
        const json = await agentSearch(text)
        const payload = json.data || json
        const raw = payload.response || null
        const cleaned = raw ? stripMarkdown(raw) : "Voici les résultats correspondants à votre recherche."
        setAnswer(cleaned)
        setTranscript("")
        speak(cleaned)
      } catch (e: any) {
        setError(e?.message || "Une erreur est survenue lors de la recherche IA.")
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
      try {
        recognitionRef.current?.stop()
      } catch {}
      try {
        if (typeof window !== "undefined") window.speechSynthesis?.cancel()
      } catch {}
      stopAudioViz()
      return
    }
    setQuery(initialQuery || "")
    setAnswer(null)
    setError(null)
    setTranscript("")
    // Démarrer directement en écoute si on veut un effet immersif
    // startListening()
  }, [open])

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop()
      } catch {}
      try {
        if (typeof window !== "undefined") window.speechSynthesis?.cancel()
      } catch {}
      stopAudioViz()
    }
  }, [])

  if (!open) return null

  const orbState = status === "error" ? "idle" : status

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-end gap-2 px-4 sm:px-6 py-4">
        <button className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/5 transition-colors text-sm">
          <MoreHorizontal size={16} />
        </button>
        <button className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/5 transition-colors text-sm">
          <Sparkles size={15} />
          <span>Passer à l'offre supérieure</span>
          <ArrowUpRight size={14} />
        </button>
        <button className="w-9 h-9 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/5 transition-colors">
          <Share2 size={17} />
        </button>
        <button className="w-9 h-9 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/5 transition-colors">
          <Settings size={17} />
        </button>
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Fermer"
        >
          <X size={19} />
        </button>
      </div>

      {/* Center content */}
      <div className="flex-1 flex flex-col items-center justify-center relative px-4">
        <div className="relative">
          <div className="absolute -inset-[120px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.28)_0%,rgba(59,130,246,0.12)_35%,transparent_70%)] blur-[90px]" />
          <div className="absolute -inset-[80px] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.16)_0%,transparent_65%)] blur-[70px]" />
          <AIChatOrb size={230} className="relative" active state={orbState as any} />
        </div>

        {/* Audio waves */}
        {(status === "listening" || status === "speaking") && (
          <div className="absolute bottom-[28%] flex items-end gap-[3px] h-16">
            {bars.map((h, i) => (
              <div
                key={i}
                className={cn(
                  "w-[2px] rounded-full transition-all duration-75",
                  status === "speaking" ? "bg-blue-400/80" : "bg-cyan-300/90"
                )}
                style={{ height: `${h}px` }}
              />
            ))}
          </div>
        )}

        {/* Status text */}
        <div className="absolute bottom-[22%] text-center">
          {status === "idle" && !answer && !error && (
            <p className="text-white/60 text-sm">Appuie sur le micro ou écris pour commencer</p>
          )}
          {status === "listening" && (
            <p className="text-white/80 text-sm">Je t'écoute...</p>
          )}
          {status === "thinking" && (
            <p className="text-white/80 text-sm">Je réfléchis...</p>
          )}
          {status === "speaking" && (
            <p className="text-white/80 text-sm">Je parle...</p>
          )}
          {status === "error" && error && (
            <p className="text-red-400 text-sm max-w-md">{error}</p>
          )}
        </div>

        {/* Transcript / Answer subtle */}
        {transcript && status === "listening" && (
          <div className="absolute bottom-[16%] max-w-2xl text-center px-4">
            <p className="text-white/90 text-base sm:text-lg leading-relaxed">{transcript}</p>
          </div>
        )}
        {answer && status === "idle" && (
          <div className="absolute bottom-[14%] max-w-3xl text-center px-6">
            <p className="text-white/90 text-sm sm:text-base leading-relaxed whitespace-pre-wrap line-clamp-4">
              {answer}
            </p>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="pb-6 px-4">
        <div className="mx-auto w-[min(880px,94vw)] h-14 bg-[#1C1C1C] rounded-full flex items-center gap-2 px-2 sm:px-3 shadow-[0_40px_80px_-60px_rgba(59,130,246,0.9)]">
          <button className="w-9 h-9 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/5 transition-colors">
            <Plus size={18} />
          </button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder="Écrivez"
            className="flex-1 bg-transparent text-white placeholder:text-white/40 text-sm sm:text-base outline-none px-1"
          />
          <button
            onClick={startListening}
            disabled={status === "thinking" || status === "speaking"}
            className={cn(
              "w-9 h-9 flex items-center justify-center rounded-full transition-colors",
              status === "listening" ? "bg-red-500 text-white" : "text-white/70 hover:text-white hover:bg-white/5",
              (status === "thinking" || status === "speaking") && "opacity-40 pointer-events-none"
            )}
            title="Parler à l'assistant"
          >
            {status === "listening" ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!query.trim() || status === "thinking" || status === "speaking"}
            className={cn(
              "w-9 h-9 flex items-center justify-center rounded-full bg-[#3B82F6] text-white shadow-[0_0_0_0_rgba(59,130,246,0.4)] hover:shadow-[0_0_0_6px_rgba(59,130,246,0.18)] transition-all",
              (!query.trim() || status === "thinking" || status === "speaking") && "opacity-40 pointer-events-none"
            )}
            title="Envoyer"
          >
            <ArrowUpRight size={18} />
          </button>
        </div>
        <div className="mt-2 text-center">
          <span className="text-[10px] sm:text-xs text-white/30">Ajusté à la page</span>
        </div>
      </div>
    </div>
  )
}
