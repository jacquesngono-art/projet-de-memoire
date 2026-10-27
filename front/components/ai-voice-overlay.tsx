"use client"

import { useEffect, useRef, useState } from "react"
import { X, Sparkles } from "lucide-react"
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

interface AIVoiceOverlayProps {
  open: boolean
  onClose: () => void
  initialQuery?: string
}

type Status = "listening" | "thinking" | "speaking" | "error"

export function AIVoiceOverlay({ open, onClose, initialQuery = "" }: AIVoiceOverlayProps) {
  const [status, setStatus] = useState<Status>("listening")
  const [transcript, setTranscript] = useState(initialQuery)
  const [answer, setAnswer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bars, setBars] = useState<number[]>(Array(12).fill(8))

  const recognitionRef = useRef<any>(null)
  const hasStartedRef = useRef(false)
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
    setBars(Array(12).fill(8))
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
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.7
      analyserRef.current = analyser
      const source = ctx.createMediaStreamSource(stream)
      sourceRef.current = source
      source.connect(analyser)

      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const step = Math.max(1, Math.floor(data.length / 12))
        const next = Array.from({ length: 12 }, (_, i) => {
          let sum = 0
          for (let j = 0; j < step; j++) sum += data[i * step + j] || 0
          const avg = sum / step
          const h = 6 + (avg / 255) * 38
          return Math.max(6, Math.min(44, h))
        })
        setBars(next)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch {
      // ignore viz errors
    }
  }

  const speak = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setStatus("listening")
      setAnswer(text)
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
    utter.onend = () => setStatus("listening")
    utter.onerror = () => setStatus("listening")
    window.speechSynthesis.speak(utter)
  }

  useEffect(() => {
    if (!open) {
      setStatus("listening")
      setTranscript(initialQuery)
      setAnswer(null)
      setError(null)
      hasStartedRef.current = false
      try {
        recognitionRef.current?.stop()
      } catch {}
      try {
        if (typeof window !== "undefined") window.speechSynthesis?.cancel()
      } catch {}
      stopAudioViz()
      return
    }

    if (typeof window === "undefined") return
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError("La recherche vocale n'est pas prise en charge par ce navigateur.\nUtilisez Chrome, Edge ou Opera.")
      setStatus("error")
      return
    }

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
      if (text) setTranscript(text)
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
            const cleaned = raw ? stripMarkdown(raw) : "Voici les résultats correspondants à votre demande."
            setAnswer(cleaned)
            speak(cleaned)
          } catch (e: any) {
            const msg = e?.message || "Erreur lors de la recherche IA."
            setError(msg)
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
      // keep listening state visual if needed
    }

    recognitionRef.current = recognition
    if (!hasStartedRef.current) {
      hasStartedRef.current = true
      try {
        setTranscript(initialQuery || "")
        startAudioViz()
        recognition.start()
        setStatus("listening")
      } catch (e) {
        setError("Impossible de démarrer le micro.")
        setStatus("error")
        stopAudioViz()
      }
    }

    return () => {
      try {
        recognition.stop()
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!open) return null

  const orbState = status === "error" ? "idle" : status

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl mx-4 flex flex-col items-center gap-6 anim-scale-in">
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 md:-right-12 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          aria-label="Fermer"
        >
          <X size={18} />
        </button>

        <div className="relative">
          <div className="absolute -inset-12 rounded-full bg-gradient-to-r from-violet-500/35 via-fuchsia-500/25 to-amber-400/35 blur-3xl" />
          <AIChatOrb size={130} className="relative" active state={orbState as any} />
        </div>

        <div className="flex items-end gap-1 h-10">
          {bars.map((h, i) => (
            <div
              key={i}
              className={cn("w-1 rounded-full transition-all duration-75", status === "listening" ? "bg-fuchsia-300" : "bg-white/40")}
              style={{ height: `${h}px` }}
            />
          ))}
        </div>

        <div className="w-full bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b border-stone-100 flex items-center gap-2">
            <Sparkles size={16} className="text-amber-500" />
            <span className="text-sm font-semibold text-stone-800">Assistant IA NestFind</span>
            <span className="ml-auto text-xs text-stone-400">
              {status === "listening" && "En écoute..."}
              {status === "thinking" && "Je réfléchis..."}
              {status === "speaking" && "Je parle..."}
              {status === "error" && "Erreur"}
            </span>
          </div>

          <div className="px-6 py-5 space-y-4">
            {(status === "listening" || transcript) && (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-stone-900 text-white px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                  {transcript || "Parlez pour décrire votre bien idéal..."}
                </div>
              </div>
            )}

            {status === "thinking" && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-md bg-stone-100 px-4 py-2.5">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-stone-400 ai-typing-dot" />
                    <span className="w-1.5 h-1.5 rounded-full bg-stone-400 ai-typing-dot [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-stone-400 ai-typing-dot [animation-delay:300ms]" />
                  </div>
                  <span className="text-xs text-stone-500">Recherche des biens...</span>
                </div>
              </div>
            )}

            {(status === "speaking" || answer) && answer && (
              <div className="flex justify-start">
                <div className="max-w-[90%] rounded-2xl rounded-tl-md bg-stone-50 border border-stone-100 px-4 py-3 text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">
                  {answer}
                </div>
              </div>
            )}

            {status === "error" && error && (
              <div className="flex justify-center">
                <div className="max-w-[90%] rounded-2xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700 text-center whitespace-pre-wrap">
                  {error}
                </div>
              </div>
            )}
          </div>

          {(status === "speaking" || status === "error") && (
            <div className="px-6 pb-5 flex justify-center">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-full bg-stone-900 text-white text-sm hover:bg-stone-800 transition-colors"
              >
                Fermer
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
