import type React from "react"

export function AIChatOrb({
  className,
  size = 56,
  variant = "default",
  active = false,
  state = "idle",
}: { className?: string; size?: number; variant?: "default" | "red"; active?: boolean; state?: "idle" | "listening" | "thinking" | "speaking" }) {
  const colors =
    variant === "red"
      ? {
          bg: "#fef2f2",
          circle1: "#ef4444",
          circle2: "#f87171",
          circle3: "#dc2626",
          circle4: "#fca5a5",
          circle5: "#fb7185",
        }
      : {
          bg: "#cff1f4",
          circle1: "#9e9fef",
          circle2: "#c471ec",
          circle3: "#9bc761",
          circle4: "#ccd4f2",
          circle5: "#f472b6",
        }

  const blurAmount = Math.max(6, size * 0.15)
  const sizes = [size * 0.45, size * 0.35, size * 0.5, size * 0.25, size * 0.3]

  const pulseDuration =
    state === "speaking" ? "1.6s" : state === "listening" ? "1.1s" : state === "thinking" ? "2.2s" : "8s"
  const scale = state === "speaking" ? 1.08 : state === "listening" ? 1.1 : state === "thinking" ? 1.04 : 1

  return (
    <div
      className={`relative rounded-full overflow-hidden ${className} ${active ? "ai-orb-active" : ""}`}
      style={{
        width: size,
        height: size,
        backgroundColor: colors.bg,
        animation: `orb-hue-rotate ${pulseDuration} linear infinite`,
        transform: `scale(${scale})`,
        transition: "transform 0.35s ease, box-shadow 0.35s ease",
        boxShadow:
          state === "speaking"
            ? "0 0 0 0 rgba(196, 113, 236, 0.5), 0 14px 44px rgba(158, 159, 239, 0.65), inset 0 2px 4px rgba(255, 255, 255, 0.35)"
            : state === "listening"
              ? "0 0 0 0 rgba(244, 114, 182, 0.45), 0 12px 38px rgba(158, 159, 239, 0.6), inset 0 2px 4px rgba(255, 255, 255, 0.32)"
              : "rgba(17, 12, 46, 0.15) 0px 48px 100px 0px",
      }}
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          "--orb-blur": `${blurAmount}px`,
          animation: "orb-hue-rotate-blur 6s linear infinite reverse",
        } as React.CSSProperties}
      >
        {[colors.circle1, colors.circle2, colors.circle3, colors.circle4, colors.circle5].map((color, i) => (
          <div
            key={i}
            className={`orb-circle-${i + 1} absolute rounded-full`}
            style={{
              width: sizes[i],
              height: sizes[i],
              opacity: 0.85 + (i % 2) * 0.05,
              backgroundColor: color,
            }}
          />
        ))}
      </div>
      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background: "linear-gradient(to bottom, rgba(255, 255, 255, 0.4) 0%, transparent 100%)",
        }}
      />
    </div>
  )
}
