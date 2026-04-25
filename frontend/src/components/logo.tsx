"use client";

/**
 * Beakon brand mark (v2 — cleaner execution).
 *
 * Design:
 *   - Navy rounded square "tile" as the base (trust, structure, accounting).
 *   - A mint arc peeking from the top-right corner — the beacon light.
 *     Geometrically a circle clipped by the tile, so only the lit crescent
 *     shows. No generic "sparkle" iconography.
 *   - A confident bold "B" in white over the top.
 *
 * Why this works:
 *   - Recognizable at 16 × 16 px (favicon)
 *   - Two colors only — no gradients, no shadows
 *   - Holds up next to Linear / Stripe / Brex-style modern marks
 *   - Matches `brand-700` + `mint-500` tokens already in the stylesheet
 */

import type { CSSProperties } from "react";


const NAVY = "#234f60"; // brand-700
const MINT = "#3aa888"; // mint-500


interface LogoProps {
  variant?: "icon" | "horizontal" | "stacked";
  /** Height in px. Width scales automatically. */
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Tagline override for the stacked variant. */
  tagline?: string;
  /** Override brand colors (e.g. for dark backgrounds). */
  colors?: { primary?: string; accent?: string; text?: string };
}


export default function Logo({
  variant = "icon",
  size,
  className,
  style,
  tagline = "AI-native accounting",
  colors,
}: LogoProps) {
  const c = {
    primary: colors?.primary ?? NAVY,
    accent: colors?.accent ?? MINT,
    text: colors?.text ?? NAVY,
  };

  if (variant === "horizontal") {
    const h = size ?? 40;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 200 48"
        height={h}
        role="img"
        aria-label="Beakon — AI-native accounting"
        className={className}
        style={style}
      >
        <Tile colors={c} />
        <Wordmark x={60} y={33} size={30} color={c.text} />
      </svg>
    );
  }

  if (variant === "stacked") {
    const h = size ?? 120;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 180 160"
        height={h}
        role="img"
        aria-label="Beakon — AI-native accounting"
        className={className}
        style={style}
      >
        <g transform="translate(66 0)">
          <Tile colors={c} />
        </g>
        <Wordmark x={90} y={100} size={34} color={c.text} centered />
        <text
          x={90}
          y={128}
          textAnchor="middle"
          fontFamily='system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", sans-serif'
          fontSize={11}
          letterSpacing="3"
          fill={c.text}
          opacity="0.55"
        >
          {tagline.toUpperCase()}
        </text>
      </svg>
    );
  }

  // icon
  const h = size ?? 40;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      height={h}
      role="img"
      aria-label="Beakon"
      className={className}
      style={style}
    >
      <Tile colors={c} />
    </svg>
  );
}


/* ────────────────────────── primitives ─────────────────────────── */

/** The 48×48 icon itself. Consumed by all three variants. */
function Tile({
  colors,
}: {
  colors: { primary: string; accent: string };
}) {
  return (
    <>
      <defs>
        <clipPath id="beakon-tile-clip">
          <rect x="0" y="0" width="48" height="48" rx="11" />
        </clipPath>
      </defs>
      <g clipPath="url(#beakon-tile-clip)">
        {/* Navy base */}
        <rect x="0" y="0" width="48" height="48" rx="11" fill={colors.primary} />
        {/* Mint moon peeking out of the top-right corner */}
        <circle cx="44" cy="4" r="13" fill={colors.accent} />
      </g>
      {/* Bold white "B" sitting on top of both layers */}
      <text
        x="13"
        y="36"
        fontFamily='system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", sans-serif'
        fontSize="31"
        fontWeight="800"
        letterSpacing="-1"
        fill="#ffffff"
      >
        B
      </text>
    </>
  );
}


function Wordmark({
  x, y, size, color, centered,
}: {
  x: number;
  y: number;
  size: number;
  color: string;
  centered?: boolean;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={centered ? "middle" : "start"}
      fontFamily='system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", sans-serif'
      fontSize={size}
      fontWeight="700"
      letterSpacing="-1.2"
      fill={color}
    >
      Beakon
    </text>
  );
}
