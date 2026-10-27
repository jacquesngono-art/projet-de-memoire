"use client"

/**
 * Conversation vocale immersive (style ChatGPT Voice / Gemini Live) :
 * fond noir plein écran, sphère lumineuse bleue-blanche au centre,
 * barre de saisie flottante en bas. L'échange est entièrement vocal :
 * SpeechRecognition (fr-FR) à l'entrée, speechSynthesis (TTS) à la sortie,
 * et ré-écoute automatique après chaque réponse — un vrai dialogue humain↔robot.
 */

import { useEffect, useRef, useState } from "react"
import { X, Plus, Mic, ArrowUpRight } from "lucide-react"
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

type Status = "idle" | "listening" | "thinking" | "speaking" | "error"

interface AIVoiceConversationProps {
  open: boolean
  onClose: () => void
}

export function AIVoiceConversation({ open, onClose }: AIVoiceConversationProps) {
  const [status, setStatus] = useState<Status>("idle")
  const [heard, setHeard] = useState("")
  const [reply, setReply] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [bars, setBars] = useState<number[]>(Array(14).fill(6))

  const recognitionRef = useRef<any>(null)
  const activeRef = useRef(false)
  const statusRef = useRef<Status>("idle")
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const vizRafRef = useRef<number | null>(null)

  const setStat = (s: Status) => {
    statusRef.current = s
    setStatus(s)
  }

  function stopViz() {
    if (vizRafRef.current) {
      cancelAnimationFrame(vizRafRef.current)
      vizRafRef.current = null
    }
    try {
      sourceRef.current?.disconnect()
    } catch {}
    sourceRef.current = null
    analyserRef.current = null
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    } catch {}
    streamRef.current = null
    try {
      audioCtxRef.current?.close()
    } catch {}
    audioCtxRef.current = null
    setBars(Array(14).fill(6))
  }

  async function startViz() {
    stopViz()
    try {
      let stream = streamRef.current
      if (!stream || stream.getTracks().every((t) => t.readyState !== "live")) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        streamRef.current = stream
      }
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext
      const ctx: AudioContext = new AC()
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
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(data)
        const step = Math.max(1, Math.floor(data.length / 14))
        const next = Array.from({ length: 14 }, (_, i) => {
          let sum = 0
          for (let j = 0; j < step; j++) sum += data[i * step + j] || 0
          const avg = sum / step
          return Math.max(6, Math.min(40, 6 + (avg / 255) * 34))
        })
        setBars(next)
        vizRafRef.current = requestAnimationFrame(tick)
      }
      vizRafRef.current = requestAnimationFrame(tick)
    } catch {
      /* la visualisation est optionnelle */
    }
  }

  function speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      // Pas de TTS : on poursuit la conversation en mode écoute
      if (activeRef.current) {
        setStat("listening")
        timerRef.current = setTimeout(() => startListening(), 400)
      }
      return
    }
    try {
      window.speechSynthesis.cancel()
    } catch {}
    const u = new SpeechSynthesisUtterance(text)
    u.lang = "fr-FR"
    u.rate = 1.02
    u.pitch = 1.0
    u.volume = 1.0
    try {
      const voices = window.speechSynthesis.getVoices()
      const fr = voices.find((v) => (v.lang || "").toLowerCase().startsWith("fr"))
      if (fr) u.voice = fr
    } catch {}
    u.onstart = () => setStat("speaking")
    u.onend = () => {
      if (activeRef.current) {
        setStat("listening")
        timerRef.current = setTimeout(() => startListening(), 450)
      }
    }
    u.onerror = () => {
      if (activeRef.current) {
        setStat("listening")
        timerRef.current = setTimeout(() => startListening(), 450)
      }
    }
    window.speechSynthesis.speak(u)
  }

  async function processQuery(text: string) {
    const q = (text || "").trim()
    if (!q) {
      if (activeRef.current) startListening()
      return
    }
    try {
      recognitionRef.current?.stop?.()
    } catch {}
    stopViz()
    try {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel()
    } catch {}
    setStat("thinking")
    try {
      const json: any = await agentSearch(q)
      const payload = json?.data || json
      const answer = payload?.response
        ? stripMarkdown(payload.response)
        : "Je n'ai pas trouvé de réponse. Reformulez votre demande."
      setReply(answer)
      // Version parlée raccourcie : la restitution vocale reste naturelle
      const spoken = answer.length > 600 ? answer.slice(0, 600) + " …" : answer
      speak(spoken)
    } catch (e: any) {
      setError(e?.message || "Erreur lors de la recherche IA.")
      setStat("error")
      timerRef.current = setTimeout(() => startListening(), 1800)
    }
  }

  function startListening() {
    if (!activeRef.current || typeof window === "undefined") return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setError("La reconnaissance vocale n'est pas prise en charge par ce navigateur.\nUtilisez Chrome, Edge ou Opera.")
      setStat("error")
      return
    }
    try {
      recognitionRef.current?.abort?.()
    } catch {}

    const rec = new SR()
    rec.lang = "fr-FR"
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onresult = (event: any) => {
      let interim = ""
      let final = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript
        if (event.results[i].isFinal) final += t
        else interim += t
      }
      const text = (final || interim).trim()
      if (text) setHeard(text)
      if (final && text) {
        setHeard(text)
        stopViz()
        processQuery(text)
      }
    }

    rec.onerror = () => {
      // Silence / permission refusée : on retente doucement
      if (activeRef.current && statusRef.current === "listening") {
        setStat("idle")
      }
      stopViz()
    }

    rec.onend = () => {
      stopViz()
      // Boucle de conversation : tant que le mode est actif et qu'on est
      // toujours en attente de parole, on ré-écoute.
      if (activeRef.current && statusRef.current === "listening") {
        timerRef.current = setTimeout(() => startListening(), 500)
      }
    }

    recognitionRef.current = rec
    setHeard("")
    try {
      rec.start()
      setStat("listening")
      startViz()
    } catch {
      setStat("idle")
    }
  }

  function handleSphereTap() {
    if (status === "speaking") {
      // Interrompre la voix → écouter la personne tout de suite
      try {
        window.speechSynthesis.cancel()
      } catch {}
      setStat("listening")
      timerRef.current = setTimeout(() => startListening(), 150)
      return
    }
    if (status === "listening") {
      try {
        recognitionRef.current?.stop?.()
      } catch {}
      stopViz()
      setStat("idle")
    }
  }

  useEffect(() => {
    if (!open) return
    activeRef.current = true
    setStatus("idle")
    setError(null)
    setReply(null)
    setHeard("")
    // Le clic sur le bouton qui ouvre l'overlay donne le "geste utilisateur"
    // requis pour le micro et la synthèse vocale.
    timerRef.current = setTimeout(() => startListening(), 350)
    return () => {
      activeRef.current = false
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      try {
        recognitionRef.current?.stop?.()
      } catch {}
      try {
        if (typeof window !== "undefined") window.speechSynthesis?.cancel()
      } catch {}
      stopViz()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    return () => {
      activeRef.current = false
    }
  }, [])

  if (!open) return null

  const statusLabel =
    status === "listening"
      ? "Je t'écoute…"
      : status === "thinking"
        ? "Je réfléchis…"
        : status === "speaking"
          ? "Je te réponds…"
          : status === "error"
            ? "Oups"
            : "Appuie sur le micro ou écris"

  return (
    <div className="fixed inset-0 z-[9999] bg-black text-white">
      {/* Barre supérieure */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-5 py-4 z-10">
        <div className="flex items-center gap-2 text-white/50 text-xs">
          <span
            className={cn(
              "w-2 h-2 rounded-full",
              status === "listening" && "bg-emerald-400 animate-pulse",
              status === "thinking" && "bg-amber-400 animate-pulse",
              status === "speaking" && "bg-blue-400 animate-pulse",
              (status === "idle" || status === "error") && "bg-stone-500"
            )}
          />
          <span className="hidden sm:inline">Conversation vocale — Assistant NestFind</span>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-white/80 flex items-center justify-center transition-colors"
          aria-label="Quitter le mode vocal"
        >
          <X size={18} />
        </button>
      </div>

      {/* Zone centrale */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 pb-40">
        {/* Sphère lumineuse bleue-blanche */}
        <button
          onClick={handleSphereTap}
          className="relative outline-none group"
          aria-label={status === "speaking" ? "Interrompre la réponse" : "Sphère de l'assistant"}
          title={status === "speaking" ? "Interrompre et parler" : "Assistant vocal"}
        >
          {/* Halo diffus */}
          <div
            className={cn(
              "absolute -inset-28 rounded-full blur-[80px] transition-opacity duration-700",
              status === "idle" ? "opacity-40" : "opacity-90"
            )}
            style={{
              background:
                "radial-gradient(circle, rgba(59,130,246,0.35) 0%, rgba(37,99,235,0.18) 40%, transparent 70%)",
            }}
          />

          {/* Ondes d'émission (l'assistant parle) */}
          {status === "speaking" && (
            <>
              <span className="absolute -inset-10 rounded-full border border-blue-400/50 voice-ripple" />
              <span className="absolute -inset-10 rounded-full border border-sky-300/40 voice-ripple [animation-delay:1s]" />
            </>
          )}

          {/* Sphère */}
          <div
            className={cn(
              "relative w-56 h-56 sm:w-64 sm:h-64 rounded-full overflow-hidden transition-transform duration-500",
              status === "listening" && "voice-breathe-fast",
              status === "thinking" && "voice-breathe-slow",
              status === "speaking" && "voice-breathe-fast"
            )}
            style={{
              background:
                "radial-gradient(circle at 32% 28%, #dbeafe 0%, #93c5fd 22%, #3b82f6 52%, #1d4ed8 72%, #0a1638 100%)",
              boxShadow:
                "0 0 60px rgba(59,130,246,0.55), 0 0 120px rgba(37,99,235,0.35), inset 0 -30px 60px rgba(2,6,23,0.55)",
            }}
          >
            {/* Volute lumineuse animée */}
            <div
              className="absolute inset-0 rounded-full blur-md voice-swirl"
              style={{
                background:
                  "conic-gradient(from 0deg, rgba(255,255,255,0.35), transparent 25%, rgba(147,197,253,0.45) 50%, rgba(255,255,255,0.2) 70%, transparent 85%)",
              }}
            />
            {/* Reflet */}
            <div className="absolute top-8 left-10 w-16 h-16 rounded-full bg-white/70 blur-2xl" />
            {/* Nuage bas (effet blanc laiteux comme sur la maquette) */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-32 h-12 rounded-full bg-white/50 blur-xl" />
          </div>
        </button>

        {/* Statut */}
        <div className="mt-10 text-center max-w-xl">
          <p className="text-white/85 text-lg sm:text-xl font-medium">{statusLabel}</p>

          {/*Ondes : réelles (micro) ou animées (voix) */}
          {(status === "listening" || status === "speaking") && (
            <div className="mt-5 flex items-center justify-center gap-[3px] h-10">
              {bars.map((h, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-[3px] rounded-full",
                    status === "listening" ? "bg-cyan-300/90" : "voice-wave bg-blue-400/90"
                  )}
                  style={
                    status === "listening"
                      ? { height: `${h}px` }
                      : { animationDelay: `${(i % 7) * 120}ms` }
                  }
                />
              ))}
            </div>
          )}

          {status === "listening" && heard && (
            <p className="mt-4 text-white/70 text-sm sm:text-base leading-relaxed">{heard}</p>
          )}

          {status === "thinking" && (
            <div className="mt-5 flex items-center justify-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-white/50 ai-typing-dot" />
              <span className="w-1.5 h-1.5 rounded-full bg-white/50 ai-typing-dot [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-white/50 ai-typing-dot [animation-delay:300ms]" />
            </div>
          )}

          {status === "idle" && !reply && (
            <p className="mt-3 text-white/40 text-sm">
              Parlez : « Trouve-moi un appartement 2 chambres à Bastos, budget 150 000 FCFA »
            </p>
          )}

          {reply && (status === "idle" || status === "error") && (
            <p className="mt-4 text-white/60 text-xs sm:text-sm whitespace-pre-wrap leading-relaxed line-clamp-5 max-h-36 overflow-hidden">
              {reply}
            </p>
          )}

          {status === "error" && error && (
            <p className="mt-3 text-red-400 text-sm whitespace-pre-wrap max-w-md">{error}</p>
          )}
        </div>
      </div>

      {/* Barre de saisie flottante en bas */}
      <div className="absolute bottom-6 left-0 right-0 px-4 z-10">
        <div className="mx-auto w-[min(760px,94vw)] h-14 bg-[#1C1C1C] rounded-full flex items-center gap-2 px-2 sm:px-3 border border-white/5">
          <button
            className="w-9 h-9 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/5 transition-colors"
            title="Options"
            onClick={() => document.getElementById("ai-voice-input")?.focus()}
          >
            <Plus size={18} />
          </button>
          <input
            id="ai-voice-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim() && status !== "thinking") {
                const text = draft
                setDraft("")
                setReply(null)
                processQuery(text)
              }
            }}
            placeholder="Écrivez"
            disabled={status === "thinking"}
            className="flex-1 bg-transparent text-white placeholder:text-white/35 text-sm sm:text-base outline-none min-w-0 disabled:opacity-50"
          />
          <button
            onClick={handleSphereTap}
            title={status === "listening" ? "Arrêter l'écoute" : "Parler"}
            className={cn(
              "w-9 h-9 flex items-center justify-center rounded-full transition-colors",
              status === "listening"
                ? "bg-red-500 text-white"
                : "text-white/70 hover:text-white hover:bg-white/5"
            )}
          >
            <Mic size={18} className={status === "listening" ? "animate-pulse" : ""} />
          </button>
          <button
            onClick={() => {
              if (!draft.trim() || status === "thinking" || status === "speaking") return
              const text = draft
              setDraft("")
              setReply(null)
              processQuery(text)
            }}
            disabled={!draft.trim() || status === "thinking"}
            className={cn(
              "w-9 h-9 flex items-center justify-center rounded-full bg-blue-500 text-white transition-all",
              (!draft.trim() || status === "thinking") && "opacity-40 pointer-events-none"
            )}
            title="Envoyer"
          >
            <ArrowUpRight size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
