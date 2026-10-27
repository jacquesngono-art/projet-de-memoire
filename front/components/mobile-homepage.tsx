"use client"

import { useState, useEffect, useRef } from "react"
import Image from "next/image"
import {
  Search, MapPin, Star, Heart, BedDouble, Bath, Wifi,
  ChevronRight, ArrowRight, CheckCircle2, Users, Home,
  TrendingUp, Shield, Zap, Globe, Play, Quote, Building2
} from "lucide-react"
import { NestFindLogo } from "@/components/nestfind-logo"
import { InteractiveDemo } from "@/components/interactive-demo"
import { cn } from "@/lib/utils"

/* ── Utility: counter animation ── */
function useCounter(target: number, duration = 1600, start = false) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!start) return
    let startTime: number | null = null
    const step = (ts: number) => {
      if (!startTime) startTime = ts
      const progress = Math.min((ts - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(Math.floor(eased * target))
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [target, duration, start])
  return count
}

/* ── Utility: in-view hook ── */
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect() } }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return { ref, visible }
}

/* ── Data ── */
const FEATURES = [
  { icon: Search, title: "Recherche Intelligente", desc: "Nos filtres propulsés par l'IA vous permettent de trouver le bien exact que vous cherchez en quelques secondes — par localisation, prix, équipements ou style." },
  { icon: Globe, title: "Visites Virtuelles", desc: "Visitez n'importe quel bien depuis n'importe où avec des visites 3D immersives. Aucun déplacement, aucun trajet gaspillé — juste des décisions éclairées." },
  { icon: Shield, title: "Annonces Vérifiées", desc: "Chaque bien est vérifié par nos agents. Pas d'arnaques, pas de surprises. Ce que vous voyez est exactement ce que vous obtenez." },
  { icon: Zap, title: "Réservation Instantanée", desc: "Réservez une visite ou un séjour en un seul tap. Notre calendrier en temps réel se synchronise automatiquement avec les agents et propriétaires." },
  { icon: TrendingUp, title: "Tendances du Marché", desc: "Prix en temps réel, comparaisons de quartiers et scores d'investissement vous donnent l'avantage pour acheter ou louer au bon moment." },
  { icon: Users, title: "Agents Experts", desc: "Connectez-vous directement avec des agents locaux vérifiés qui connaissent le marché sur le bout des doigts. Pas d'intermédiaires, pas de délais." },
]

const STEPS = [
  { num: "01", title: "Dites-nous ce que vous cherchez", desc: "Définissez vos préférences — ville, budget, chambres, style. Notre moteur intelligent crée instantanément votre profil de bien idéal." },
  { num: "02", title: "Explorez les biens sélectionnés", desc: "Parcourez des annonces personnalisées avec visites virtuelles, scores de quartier et disponibilité en temps réel — tout au même endroit." },
  { num: "03", title: "Réservez, visitez, emménagez", desc: "Planifiez une visite, faites une offre ou réservez un séjour. Nos agents s'occupent des formalités pour que vous puissiez vous concentrer sur le déménagement." },
]

const TESTIMONIALS = [
  { name: "Sarah K.", role: "Première acquisition", location: "Yaoundé, CM", text: "NestFind a rendu l'achat de ma première maison totalement sans stress. J'ai trouvé le bien parfait en deux semaines — quelque chose que je pensais prendre des mois.", avatar: "SK", rating: 5 },
  { name: "Marcus T.", role: "Investisseur immobilier", location: "Douala, CM", text: "Les tendances du marché valent à elles seules le détour. J'ai finalisé trois propriétés d'investissement le trimestre dernier grâce aux données de NestFind.", avatar: "MT", rating: 5 },
  { name: "Priya M.", role: "Professionnelle en mobilité", location: "Bafoussam, CM", text: "J'ai déménagé de Douala à Yaoundé sans aucune visite préalable. Les visites virtuelles étaient si détaillées que j'avais l'impression d'avoir déjà vécu là-bas.", avatar: "PM", rating: 5 },
]

const STATS = [
  { value: 48000, suffix: "+", label: "Biens en ligne" },
  { value: 96, suffix: "%", label: "Taux de satisfaction" },
  { value: 12, suffix: "K+", label: "Familles satisfaites" },
  { value: 8, suffix: "min", label: "Temps moyen de matching" },
]

const PROPERTY_TYPES = [
  { label: "Villa", img: "/images/house-1.jpg", count: "1 240 annonces" },
  { label: "Appartement", img: "/images/house-2.jpg", count: "3 800 annonces" },
  { label: "Maison", img: "/images/house-3.jpg", count: "620 annonces" },
  { label: "Terrain", img: "/images/house-4.jpg", count: "340 annonces" },
]

// Visuels mis en avant sur la page d'accueil : biens réels du catalogue
// (résidence) et repère local (sculpture artistique) fournis par l'équipe.
const HERO_IMG_RESIDENCE = "/images/accueil-residence.jpg"
const HERO_IMG_SCULPTURE = "/images/accueil-sculpture.jpg"

/* ── Stats Counter Section ── */
function StatsSection() {
  const { ref, visible } = useInView()
  const c0 = useCounter(STATS[0].value, 1800, visible)
  const c1 = useCounter(STATS[1].value, 1400, visible)
  const c2 = useCounter(STATS[2].value, 1600, visible)
  const c3 = useCounter(STATS[3].value, 1200, visible)
  const counts = [c0, c1, c2, c3]

  return (
    <div ref={ref} className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border border border-border rounded-2xl overflow-hidden">
      {STATS.map((s, i) => (
        <div key={s.label} className="bg-background flex flex-col items-center justify-center py-8 px-4 text-center"
          style={{ animationDelay: `${i * 80}ms` }}>
          <div className="text-[36px] font-black text-foreground leading-none tracking-tight tabular-nums">
            {counts[i].toLocaleString()}{s.suffix}
          </div>
          <div className="text-[12.5px] text-muted-foreground mt-2 font-medium">{s.label}</div>
        </div>
      ))}
    </div>
  )
}

/* ── Main Component ── */
export function MobileHomePage({ onLaunchApp }: { onLaunchApp: () => void }) {
  const [activeType, setActiveType] = useState(0)
  const [email, setEmail] = useState("")
  const [submitted, setSubmitted] = useState(false)

  const heroRef = useInView(0.05)
  const featuresRef = useInView()
  const stepsRef = useInView()
  const testimonialsRef = useInView()
  const typesRef = useInView()
  const ctaRef = useInView()

  return (
    <div className="w-full bg-background text-foreground font-sans overflow-x-hidden">

      {/* ──────────── HERO ──────────── */}
      <section
        ref={heroRef.ref}
        className="relative min-h-[92vh] flex flex-col items-center justify-center text-center px-6 pt-20 pb-16 overflow-hidden"
      >
        {/* Subtle grid background */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: "linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }} />
        {/* Radial glow */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(0,0,0,0.04) 0%, transparent 70%)",
        }} />

        <div className={cn("relative z-10 max-w-4xl mx-auto", heroRef.visible ? "anim-fade-up" : "opacity-0")}>
          {/* Headline */}
          <h1 className="text-[48px] sm:text-[64px] md:text-[76px] font-black text-foreground leading-[0.95] tracking-tight text-balance mb-6">
            Trouvez votre bien<br />
            <span className="relative inline-block">
              le plus rapidement
              <svg className="absolute -bottom-1 left-0 w-full" height="6" viewBox="0 0 400 6" preserveAspectRatio="none">
                <path d="M0 5 Q200 0 400 5" stroke="#0a0a0a" strokeWidth="2.5" fill="none" strokeLinecap="round" />
              </svg>
            </span>
          </h1>

          <p className="text-[17px] sm:text-[19px] text-muted-foreground leading-relaxed max-w-2xl mx-auto text-pretty mb-10">
            Parcourez des milliers de biens vérifiés, faites des visites virtuelles et contactez des agents experts — sans quitter votre canapé.
          </p>

          {/* CTA group */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
            <button
              onClick={onLaunchApp}
              className="flex items-center gap-2.5 bg-foreground text-background px-7 py-4 rounded-full font-bold text-[15px] w-full sm:w-auto justify-center"
              style={{ transition: "transform 0.18s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 12px 32px rgba(0,0,0,0.18)" }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "none" }}
              onMouseDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
              onMouseUp={e => (e.currentTarget.style.transform = "translateY(-2px)")}
            >
              <Home size={16} />
              Commencer
            </button>
            <button
              className="flex items-center gap-2.5 border border-border text-foreground px-7 py-4 rounded-full font-semibold text-[15px] w-full sm:w-auto justify-center bg-background"
              style={{ transition: "transform 0.18s cubic-bezier(0.34,1.56,0.64,1), background 0.2s" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--muted)")}
              onMouseLeave={e => (e.currentTarget.style.background = "var(--background)")}
            >
              <Play size={13} fill="currentColor" />
              Voir la démo
            </button>
          </div>

          {/* Trust badges */}
          <div className="flex flex-wrap items-center justify-center gap-5 text-[12px] text-muted-foreground">
            {["Sans inscription", "48 000+ annonces", "Agents vérifiés", "Gratuit pour parcourir"].map((b, i) => (
              <span key={b} className="flex items-center gap-1.5 anim-fade-up" style={{ animationDelay: `${300 + i * 60}ms` }}>
                <CheckCircle2 size={12} className="text-foreground/60" />
                {b}
              </span>
            ))}
          </div>
        </div>

        {/* Floating property cards decorative */}
        <div className="absolute right-8 top-1/2 -translate-y-1/2 hidden xl:flex flex-col gap-3 anim-slide-right" style={{ animationDelay: "400ms" }}>
          {[HERO_IMG_RESIDENCE, HERO_IMG_SCULPTURE].map((img, i) => (
            <div key={i} className="w-52 rounded-2xl overflow-hidden border border-border shadow-xl bg-background"
              style={{ transform: i === 0 ? "rotate(2deg)" : "rotate(-1.5deg)", animationDelay: `${400 + i * 120}ms` }}>
              <div className="relative h-32 overflow-hidden">
                <Image src={img} alt="Property" fill sizes="208px" className="object-cover" />
              </div>
              <div className="p-3">
                <div className="h-2.5 w-24 bg-muted rounded-full mb-1.5" />
                <div className="h-2 w-16 bg-muted/60 rounded-full" />
              </div>
            </div>
          ))}
        </div>

        <div className="absolute left-8 top-1/2 -translate-y-1/2 hidden xl:flex flex-col gap-3 anim-slide-left" style={{ animationDelay: "350ms" }}>
          {[HERO_IMG_SCULPTURE, HERO_IMG_RESIDENCE].map((img, i) => (
            <div key={i} className="w-44 rounded-2xl overflow-hidden border border-border shadow-xl bg-background"
              style={{ transform: i === 0 ? "rotate(-2deg)" : "rotate(1.5deg)", animationDelay: `${350 + i * 120}ms` }}>
              <div className="relative h-28 overflow-hidden">
                <Image src={img} alt="Property" fill sizes="176px" className="object-cover" />
              </div>
              <div className="p-2.5">
                <div className="h-2 w-20 bg-muted rounded-full mb-1.5" />
                <div className="h-2 w-14 bg-muted/60 rounded-full" />
              </div>
            </div>
          ))}
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 anim-fade-in" style={{ animationDelay: "800ms" }}>
          <span className="text-[10.5px] text-muted-foreground uppercase tracking-widest font-semibold">Défiler pour explorer</span>
          <div className="w-px h-8 bg-gradient-to-b from-border to-transparent" />
        </div>
      </section>

      {/* ──────────── STATS ──────────── */}
      <section className="px-6 py-12 max-w-5xl mx-auto">
        <StatsSection />
      </section>

      {/* ──────────── PROPERTY TYPES ──────────── */}
      <section ref={typesRef.ref} className="px-6 py-16 max-w-5xl mx-auto">
        <div className={cn("mb-10", typesRef.visible ? "anim-fade-up" : "opacity-0")}>
          <p className="text-[11.5px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Parcourir par type</p>
          <h2 className="text-[32px] sm:text-[40px] font-black text-foreground leading-tight text-balance">
            Tous les styles de vie,<br />au même endroit.
          </h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {PROPERTY_TYPES.map((type, i) => (
            <button
              key={type.label}
              onClick={() => setActiveType(i)}
              className={cn(
                "group relative rounded-2xl overflow-hidden text-left border anim-fade-up",
                activeType === i ? "border-foreground ring-2 ring-foreground/10" : "border-border"
              )}
              style={{
                animationDelay: typesRef.visible ? `${i * 70}ms` : "0ms",
                transition: "transform 0.22s cubic-bezier(0.22,1,0.36,1), border-color 0.2s ease",
              }}
              onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-4px)")}
              onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}
            >
              <div className="relative overflow-hidden" style={{ height: 140 }}>
                <Image src={type.img} alt={type.label} fill sizes="280px" className="object-cover"
                  style={{ transition: "transform 0.5s ease", transform: activeType === i ? "scale(1.08)" : "scale(1)" }} />
                <div className={cn("absolute inset-0 transition-opacity duration-300",
                  activeType === i ? "bg-foreground/30" : "bg-foreground/10 group-hover:bg-foreground/20")} />
              </div>
              <div className="p-3 bg-background">
                <p className="text-[13px] font-bold text-foreground">{type.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{type.count}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ──────────── INTERACTIVE DEMO ──────────── */}
      <section className="px-0 py-4">
        <div className="max-w-5xl mx-auto px-6 mb-8">
          <p className="text-[11.5px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Aperçu en direct</p>
          <h2 className="text-[32px] sm:text-[40px] font-black text-foreground leading-tight text-balance">
            Essayez avant<br />de vous engager.
          </h2>
        </div>
        <InteractiveDemo />
      </section>

      {/* ──────────── FEATURES ──────────── */}
      <section ref={featuresRef.ref} className="px-6 py-20 max-w-5xl mx-auto">
        <div className={cn("mb-12", featuresRef.visible ? "anim-fade-up" : "opacity-0")}>
          <p className="text-[11.5px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Pourquoi NestFind</p>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <h2 className="text-[32px] sm:text-[40px] font-black text-foreground leading-tight text-balance max-w-md">
              Conçu pour la vraie façon dont les gens trouvent un logement.
            </h2>
            <p className="text-[14px] text-muted-foreground leading-relaxed max-w-xs">
              Nous avons traqué chaque point de friction dans le parcours de recherche immobilière et l'avons éliminé.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className={cn(
                "group p-6 rounded-2xl border border-border bg-background anim-fade-up",
                "hover:border-foreground/20 hover:shadow-md"
              )}
              style={{
                animationDelay: featuresRef.visible ? `${i * 60}ms` : "0ms",
                transition: "transform 0.22s cubic-bezier(0.22,1,0.36,1), box-shadow 0.2s ease, border-color 0.2s",
              }}
              onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-3px)")}
              onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}
            >
              <div className="w-10 h-10 rounded-xl bg-foreground flex items-center justify-center mb-4"
                style={{ transition: "transform 0.2s cubic-bezier(0.34,1.56,0.64,1)" }}
                onMouseEnter={e => (e.currentTarget.style.transform = "rotate(8deg) scale(1.1)")}
                onMouseLeave={e => (e.currentTarget.style.transform = "rotate(0) scale(1)")}
              >
                <f.icon size={18} className="text-background" />
              </div>
              <h3 className="text-[15px] font-bold text-foreground mb-2">{f.title}</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ──────────── HOW IT WORKS ──────────── */}
      <section ref={stepsRef.ref} className="px-6 py-20 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <div className={cn("mb-14 text-center", stepsRef.visible ? "anim-fade-up" : "opacity-0")}>
            <p className="text-[11.5px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Comment ça marche</p>
            <h2 className="text-[32px] sm:text-[40px] font-black text-foreground leading-tight text-balance">
              De la recherche aux clés<br />en trois étapes.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* Connector line (desktop) */}
            <div className="hidden md:block absolute top-10 left-[calc(16.6%+12px)] right-[calc(16.6%+12px)] h-px bg-border" />

            {STEPS.map((step, i) => (
              <div key={step.num}
                className={cn("flex flex-col gap-4 anim-fade-up", stepsRef.visible ? "" : "opacity-0")}
                style={{ animationDelay: stepsRef.visible ? `${i * 120}ms` : "0ms" }}>
                <div className="flex items-center gap-4 md:flex-col md:items-start">
                  <div className="w-10 h-10 rounded-full bg-foreground text-background flex items-center justify-center text-[12px] font-black shrink-0 z-10">
                    {i + 1}
                  </div>
                  <div className="md:hidden h-px flex-1 bg-border" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{step.num}</p>
                  <h3 className="text-[17px] font-bold text-foreground mb-2">{step.title}</h3>
                  <p className="text-[13.5px] text-muted-foreground leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────── TESTIMONIALS ──────────── */}
      <section ref={testimonialsRef.ref} className="px-6 py-20 bg-foreground text-background">
        <div className="max-w-5xl mx-auto">
          <div className={cn("mb-12", testimonialsRef.visible ? "anim-fade-up" : "opacity-0")}>
            <p className="text-[11.5px] font-bold uppercase tracking-widest text-background/50 mb-3">Ce que disent les utilisateurs</p>
            <h2 className="text-[32px] sm:text-[40px] font-black text-background leading-tight text-balance">
              Des personnes réelles.<br />Des biens réels trouvés.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <div key={t.name}
                className="rounded-2xl border border-background/10 p-6 bg-background/5 backdrop-blur anim-fade-up"
                style={{ animationDelay: testimonialsRef.visible ? `${i * 80}ms` : "0ms" }}>
                <Quote size={20} className="text-background/30 mb-4" />
                <p className="text-[14px] text-background/80 leading-relaxed mb-6">{t.text}</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-background/20 flex items-center justify-center text-[12px] font-black text-background">
                      {t.avatar}
                    </div>
                    <div>
                      <p className="text-[12.5px] font-bold text-background">{t.name}</p>
                      <p className="text-[10.5px] text-background/50">{t.role} · {t.location}</p>
                    </div>
                  </div>
                  <div className="flex gap-0.5">
                    {[1,2,3,4,5].map(s => <Star key={s} size={10} className="fill-amber-400 text-amber-400" />)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────── FEATURE HIGHLIGHT SPLIT ──────────── */}
      <section className="px-6 py-20 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div className="anim-slide-left">
            <p className="text-[11.5px] font-bold uppercase tracking-widest text-muted-foreground mb-4">Plateforme</p>
            <h2 className="text-[32px] font-black text-foreground leading-tight text-balance mb-5">
              Disponible sur tous vos appareils, partout où vous allez.
            </h2>
            <p className="text-[14px] text-muted-foreground leading-relaxed mb-8">
              Que vous soyez sur votre téléphone pendant le trajet ou sur votre ordinateur à la maison, NestFind offre la même expérience fluide sur toutes les plateformes.
            </p>
            <div className="flex flex-col gap-3">
              {[
                { icon: Zap, label: "Synchronisation instantanée entre appareils" },
                { icon: Globe, label: "Disponible dans plus de 40 villes au Cameroun" },
                { icon: Shield, label: "Données chiffrées de bout en bout" },
                { icon: Building2, label: "Annonces résidentielles et commerciales" },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-lg bg-foreground/8 border border-border flex items-center justify-center shrink-0">
                    <item.icon size={12} className="text-foreground/70" />
                  </div>
                  <span className="text-[13.5px] text-foreground font-medium">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="relative anim-slide-right">
            <div className="grid grid-cols-2 gap-3">
              {[HERO_IMG_RESIDENCE, HERO_IMG_SCULPTURE, HERO_IMG_RESIDENCE, HERO_IMG_SCULPTURE].map((img, i) => (
                <div key={i} className="rounded-2xl overflow-hidden border border-border"
                  style={{ height: i % 2 === 0 ? 160 : 120, marginTop: i === 1 || i === 3 ? 24 : 0 }}>
                  <div className="relative w-full h-full">
                    <Image src={img} alt="Property" fill sizes="200px" className="object-cover" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ──────────── EMAIL CTA ──────────── */}
      <section ref={ctaRef.ref} className="px-6 py-20 border-t border-border">
        <div className={cn("max-w-2xl mx-auto text-center", ctaRef.visible ? "anim-fade-up" : "opacity-0")}>
          <h2 className="text-[36px] sm:text-[48px] font-black text-foreground leading-tight text-balance mb-4">
            Commencez à trouver votre bien de rêve dès aujourd'hui.
          </h2>
          <p className="text-[15px] text-muted-foreground leading-relaxed mb-10">
            Rejoignez plus de 12 000 familles qui ont trouvé leur maison idéale avec NestFind. Sans carte bancaire, sans engagement.
          </p>

          {submitted ? (
            <div className="flex flex-col items-center gap-3 anim-scale-in">
              <div className="w-14 h-14 rounded-full bg-foreground flex items-center justify-center">
                <CheckCircle2 size={26} className="text-background" />
              </div>
              <p className="text-[15px] font-bold text-foreground">Vous êtes sur la liste.</p>
              <p className="text-[13px] text-muted-foreground">Nous vous contacterons bientôt pour un accès anticipé.</p>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2 max-w-md mx-auto">
              <input
                type="email"
                placeholder="Entrez votre adresse e-mail"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="flex-1 border border-border rounded-full px-5 py-3.5 text-[14px] text-foreground bg-background placeholder:text-muted-foreground outline-none focus:border-foreground transition-colors"
              />
              <button
                onClick={() => { if (email.includes("@")) setSubmitted(true) }}
                className="bg-foreground text-background px-6 py-3.5 rounded-full text-[14px] font-bold whitespace-nowrap flex items-center gap-2 justify-center"
                style={{ transition: "transform 0.18s cubic-bezier(0.34,1.56,0.64,1)" }}
                onMouseDown={e => (e.currentTarget.style.transform = "scale(0.96)")}
                onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}
              >
                Accès anticipé
                <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ──────────── FOOTER ──────────── */}
      <footer className="px-6 py-10 border-t border-border">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex flex-col gap-2">
            <NestFindLogo size="md" />
            <p className="text-[12px] text-muted-foreground">Parcourez les biens immobiliers intuitivement, sans le tracas.</p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {["Fonctionnalités", "Tarifs", "À propos", "Blog", "Carrières", "Confidentialité", "Conditions"].map(link => (
              <a key={link} href="#" className="text-[12px] text-muted-foreground hover:text-foreground transition-colors">{link}</a>
            ))}
          </div>
        </div>
        <div className="max-w-5xl mx-auto mt-8 pt-6 border-t border-border">
          <p className="text-[11.5px] text-muted-foreground text-center">© 2026 NestFind Inc. Tous droits réservés.</p>
        </div>
      </footer>

    </div>
  )
}
