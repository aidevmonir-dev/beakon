"use client";

/**
 * Beakon brand mark.
 *
 * Lockups:
 *   - icon       → just the navy tile with white "B" + mint corner.
 *   - wordmark   → mint cursive "get" + bold "BEAKON" alone, no tile.
 *                  Used when the tile already lives somewhere else in the
 *                  layout (e.g., the sidebar rail) and we just need the type.
 *   - horizontal → tile + mint cursive "get" inline-left of bold "BEAKON".
 *   - stacked    → horizontal lockup with the tagline beneath it.
 *
 * Tile design: navy rounded square (trust/structure), mint moon clipped in the
 * top-right corner (the beacon light), bold white "B" on top. Two colors only,
 * no gradients. Matches `brand-700` + `mint-500` tokens.
 *
 * Fonts: Outfit for "BEAKON" + the tile "B", Allura for the cursive
 * "get", DM Sans for the stacked tagline. All loaded via next/font in
 * app/layout.tsx as CSS variables.
 */

import type { CSSProperties } from "react";


const NAVY = "#234f60"; // brand-700
const MINT = "#3aa888"; // mint-500

const SANS = 'var(--font-sans), "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const SCRIPT = 'var(--font-script), "Allura", "Apple Chancery", "Brush Script MT", cursive';
// Wordmark face — Outfit (geometric, flat terminals) reads as crafted
// logotype. Used for "BEAKON" and the tile "B".
const WORDMARK = 'var(--font-wordmark), "Outfit", "Geist", "Helvetica Neue", Arial, sans-serif';


interface LogoProps {
  variant?: "icon" | "wordmark" | "horizontal" | "stacked";
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

  if (variant === "wordmark") {
    const h = size ?? 28;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 175 48"
        height={h}
        role="img"
        aria-label="getBEAKON"
        className={className}
        style={style}
      >
        <Wordmark x={0} c={c} />
      </svg>
    );
  }

  if (variant === "horizontal") {
    const h = size ?? 40;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 230 48"
        height={h}
        role="img"
        aria-label="getBEAKON"
        className={className}
        style={style}
      >
        <Tile colors={c} />
        <Wordmark x={58} c={c} />
      </svg>
    );
  }

  if (variant === "stacked") {
    const h = size ?? 80;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 230 64"
        height={h}
        role="img"
        aria-label="getBEAKON — AI-native accounting"
        className={className}
        style={style}
      >
        <Tile colors={c} />
        <Wordmark x={58} c={c} />
        <text
          x="115"
          y="60"
          textAnchor="middle"
          fontFamily={SANS}
          fontSize="8"
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
        <circle cx="44" cy="4" r="11" fill={colors.accent} />
      </g>
      {/* Bold white "B" centered in the tile — wordmark face for cohesion */}
      <text
        x="24"
        y="36"
        textAnchor="middle"
        fontFamily={WORDMARK}
        fontSize="34"
        fontWeight="800"
        fill="#ffffff"
      >
        B
      </text>
    </>
  );
}


/**
 * "get BEAKON" wordmark — Allura signature-script "get" in navy sitting inline
 * to the LEFT of bold uppercase "BEAKON" on the same baseline. Pairs with the
 * Tile to form the horizontal lockup.
 */
function Wordmark({
  x,
  c,
}: {
  x: number;
  c: { text: string };
}) {
  return (
    <g transform={`translate(${x} 0)`}>
      <text
        x="0"
        y="34"
        fontFamily={SCRIPT}
        fontSize="38"
        fontWeight="400"
        fontStyle="italic"
        fill={c.text}
      >
        get
      </text>
      <text
        x="46"
        y="34"
        fontFamily={WORDMARK}
        fontSize="29"
        fontWeight="800"
        letterSpacing="1.6"
        fill={c.text}
      >
        BEAKON
      </text>
    </g>
  );
}
