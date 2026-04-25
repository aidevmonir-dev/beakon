# Beakon brand assets

## The mark

A confident, modern fintech mark built from three elements:

1. **Navy rounded tile** — the accounting foundation (trust, structure, ledger)
2. **Mint moon** — a circle clipped by the tile's top-right corner, appearing as a crescent of light. The beacon.
3. **Bold white "B"** — the wordmark letterform, sitting on the tile

Two-tone only. No gradients. Recognizable down to 16 × 16 px.

## Colors

| Role | Hex | Notes |
|---|---|---|
| Primary (navy) | **`#234f60`** | `brand-700` in the app's token palette. Used for the tile, wordmark, tagline |
| Accent (mint) | **`#3aa888`** | `mint-500`. The beacon / AI layer |
| Soft accent | `#7ad1b6` | `mint-300`. Reserved for monochrome-on-dark overrides |
| Letterform | `#ffffff` | The "B" inside the tile is always white |

The mark works on white, light blue (`canvas-100 #e6edf2`), or dark navy. On dark navy, override via the `colors` prop to a monochrome variant.

## Files

| File | Use |
|---|---|
| `beakon-icon.svg` | Square icon only — app icon, avatar, favicon |
| `beakon-horizontal.svg` | Icon + wordmark on one line — headers, email sigs |
| `beakon-stacked.svg` | Icon over wordmark over tagline — pitch decks, cover slides |
| `../../frontend/public/favicon.svg` | Browser favicon (same as icon) |
| `../../frontend/src/components/logo.tsx` | React component — use inside the app |

## Wordmark

`Beakon` set in `system-ui`, weight 700, letter-spacing `-1.2`, in navy (`#234f60`). The "B" inside the tile is weight 800, letter-spacing `-1`, in white. Tagline "AI-NATIVE ACCOUNTING" uses the same family at 11 px with 3 px letter-spacing, 55% opacity of primary.

## Clear space

Maintain at least **½ × tile height** of empty space around the full lockup. Do not place the default two-tone mark inside dark-navy fills — swap to a monochrome variant via the `colors` prop on the React component.

## Don'ts

- Don't change the tile corner radius (`rx=11` at 48 px) — it defines the silhouette
- Don't move or resize the mint moon individually — it's geometrically anchored at the tile's top-right corner
- Don't recolor the tile without also updating the "B" for contrast
- Don't rotate or skew the mark
- Don't outline the wordmark
- Don't drop the tagline while keeping "Beakon" in a marketing context — use `stacked` or the plain `horizontal`

## Using the React component

```tsx
import Logo from "@/components/logo";

<Logo variant="icon" size={32} />
<Logo variant="horizontal" size={40} />
<Logo variant="stacked" size={96} tagline="AI-native accounting" />

// Monochrome override for dark backgrounds:
<Logo variant="horizontal" colors={{ primary: "#ffffff", accent: "#7ad1b6", text: "#ffffff" }} />
```

## Visual preview

Open any of the three SVGs directly in a browser, or view the live versions:

- `/dashboard` (top-left of sidebar) — horizontal variant at 28 px
- `/login` — horizontal variant at 36 px
- `/` or any browser tab — icon-only favicon
