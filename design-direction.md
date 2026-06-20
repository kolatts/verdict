# Verdict — Design Direction

**Theme: "The Grand Cartoon Courtroom"**

A Victorian-era courtroom rendered in bold cartoon illustration — ink outlines, saturated deep colours, exaggerated drama. Think Harvey Birdman Attorney at Law crossed with Cartoon Network's classic era: opulent and grandiose but never taking itself seriously. The game is chaotic and funny; the design should feel like you've been summoned to a courtroom that definitely exists inside a cartoon.

---

## Colour Palette

| Name | Hex | Use |
|---|---|---|
| Walnut | `#1C0F06` | Page background |
| Mahogany | `#3A1A0A` | Deep surface, header |
| Parchment | `#F4EDCF` | Cards, readable surfaces |
| Brass | `#C8912A` | Primary accent, borders, highlights |
| Crimson | `#C01818` | Prosecution, danger, contempt badge |
| Cobalt | `#1A3E9E` | Defense |
| Cream | `#FFF8EC` | Card text areas, argument backgrounds |
| Ink | `#120A02` | Outlines, strong type |

Shift from the current muted `--accent: #c9a96e` to a richer `#C8912A` — punchier brass. Crimson replaces the current dark maroon for prosecution; it reads louder on screen and better matches the cartoon energy.

---

## Typography

| Role | Face | Notes |
|---|---|---|
| Display | **Alfa Slab One** (Google Fonts) | Bold slab serif — comic title-card energy. Use for "⚖️ Verdict", round headers, "HELD IN CONTEMPT" |
| Body | **Lora** | Warm editorial serif, replaces Georgia — slightly more distinctive, same feel |
| Testimony | **Courier Prime** | Argument text in the cards — typewriter feel, like a court transcript |
| Labels / UI | **Inter** | Clean sans for badges, counters, notices |

Load via a single `<link>` to Google Fonts covering all four families.

---

## Parallax Home Screen

The home screen (`#screen-home`) gets a full-viewport courtroom scene with four depth layers. Implement with a pinned `position: sticky` scroll container and `translateY` on each layer via a scroll event listener (or `@scroll-driven-animations` where supported, with JS fallback).

```
┌─────────────────────────────────────────────────────────┐
│  Layer 0 — background (scroll multiplier: 0.15)         │
│  Grand courtroom rear wall: tall arched windows,        │
│  walnut wainscoting, "VERDICT" carved in stone above.   │
│                                                         │
│  Layer 1 — mid (scroll multiplier: 0.35)                │
│  Judge's bench: a towering dark-wood structure, the     │
│  Judge character peering over the top, gavel raised.    │
│                                                         │
│  Layer 2 — foreground columns (scroll multiplier: 0.6)  │
│  Two thick mahogany columns, left and right, cropped    │
│  at the screen edge — partially obscure the rear.       │
│                                                         │
│  Layer 3 — particles (scroll multiplier: 1.0)           │
│  20–30 tiny floating dust motes / drifting paper        │
│  scraps, animated with CSS keyframes, no scroll tie.    │
└─────────────────────────────────────────────────────────┘
```

The title card ("⚖️ Verdict" + tagline + buttons) sits in the centre, `position: relative; z-index: 10`, above all layers. On scroll the layers drift apart, revealing depth — but since this is a single-page app most users won't scroll far, so the effect mainly plays on the initial load and mobile swipe.

**Implementation sketch:**

```js
const layers = [
  { el: document.getElementById('parallax-bg'),      speed: 0.15 },
  { el: document.getElementById('parallax-bench'),   speed: 0.35 },
  { el: document.getElementById('parallax-columns'), speed: 0.60 },
];
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  layers.forEach(({ el, speed }) => {
    el.style.transform = `translateY(${y * speed}px)`;
  });
});
```

Dust motes: 24 `<span class="mote">` elements absolutely positioned, each with a random CSS animation delay and a gentle `@keyframes float` that moves them 12–18 px vertically on a 6–10 s loop.

---

## Cartoon Characters

Place characters as `<img>` or inline SVG. On the home screen: Judge peers over the bench (Layer 1). On the argument screen: Prosecution badge swaps in a small fox avatar; Defense badge swaps in a bear avatar. On the reveal screen: Contempt section shows the Judge with gavel raised.

### Image Prompts

#### 1. Courtroom Background (Layer 0)
> A wide, grand Victorian courtroom interior rendered in bold cartoon illustration style. Thick ink outlines on every element. Tall arched leaded-glass windows on the rear wall letting in dramatic shafts of golden light. Dark walnut wood wainscoting. A carved stone frieze above reading "TRUTH · JUSTICE · HONOUR". Rows of empty dark-wood gallery pews. Colour palette: deep walnut browns, rich mahogany, cream ceiling plasterwork, brass chandelier. No characters. Wide 16:9, painted background plate, flat art style with visible brushwork, inspired by classic Cartoon Network background art and Chuck Jones layouts. High contrast, saturated.

#### 2. Judge Character
> A rotund, pompous cartoon owl judge. Large round yellow eyes, magnificent curling white moustache, tiny perched half-moon spectacles. Wearing an oversized black silk robe and a lopsided white powdered wig three sizes too large. One wing holds an enormous wooden gavel raised dramatically overhead. Expression: imperious self-satisfaction. Seated behind a towering dark mahogany bench so only his head and gavel-arm are visible above it. Thick black ink outlines. Colour palette consistent with courtroom scene. Cartoon Network / Harvey Birdman aesthetic. White background, character sheet pose, no shadow.

#### 3. Prosecution Character — The Fox
> A sleek, sharp-featured cartoon fox lawyer. Bright crimson double-breasted suit with a white pocket square. Slicked-back orange fur, small pointed ears, intense narrow eyes. Holding a black leather briefcase in one hand, pointing accusingly with the other hand's index finger. Confident smirk. Thick black ink outlines. Slightly exaggerated proportions — oversized head, slim body. Cartoon Network / Harvey Birdman aesthetic. Transparent / white background, standing pose facing slightly left.

#### 4. Defense Character — The Bear
> A rumpled, endearing cartoon bear defense attorney. Dusty blue pinstripe suit, too-wide tie askew, round tortoiseshell glasses slipping down a broad snout. Warm brown fur, slightly wide panicked eyes. Surrounded by a cascading avalanche of loose papers and manila folders, several balanced precariously on their head. One paw clutching a comically thick law book. Expression: determined but harried. Thick black ink outlines. Cartoon Network aesthetic. Transparent / white background, standing pose facing slightly right.

#### 5. Court Clerk — The Mouse
> A tiny, meticulous cartoon mouse court clerk. Wearing a miniature black court gown and neat white collar. Large round ears, small round glasses, holding an enormous quill pen in both paws. Seated at a small writing desk stacked with leather-bound ledgers. Expression: intense focus, tongue out in concentration. Thick ink outlines. Used as a "submitted — waiting for others" state illustration. Transparent background.

#### 6. Contempt Gavel Slam Illustration
> A cartoon wooden gavel mid-slam, dramatically crashing down onto a surface. Motion lines radiating outward. Small sparks and stars impact effect. A crack running through the surface. The gavel should feel enormous and authoritative. Ink outlines, bold colour, no background. Used in the "Held in Contempt" section header.

---

## Textures

#### Texture A — Dark Wood Grain (page background)
> Seamless tileable dark mahogany wood grain texture. Deep rich walnut browns (#1C0F06 to #3A1A0A range). Subtle grain lines running vertically. Slight sheen. Photorealistic but not overly detailed — works at small tile sizes (256×256 px). No knots. Used as `background-image` on `body`.

#### Texture B — Aged Parchment (card backgrounds)
> Seamless tileable aged parchment / vellum paper texture. Warm cream (#F4EDCF base) with subtle foxing spots, faint horizontal laid lines, and soft edge darkening. Not overly distressed — readable, clean. Works at 512×512 px tile. Used as `background-image` on `.card` elements layered under a cream background colour at 40% opacity.

#### Texture C — Leather (header / surface)
> Seamless tileable dark burgundy-brown leather texture. Fine pebble grain. Deep shadow in the grain grooves. Rich and tactile. Works at 256×256 px. Used on `.court-header` and `.screen-play header` at low opacity over the `--mahogany` background.

---

## Layout Adjustments

### Cards
- Add a subtle `background-image: url(parchment.png)` at 40% opacity behind the solid `--card-bg` fill.
- Increase `border-radius` to `12px`.
- Give argument cards a left border: `border-left: 5px solid var(--brass)` by default, `border-left-color: var(--crimson)` when selected.
- Add a thin inner shadow: `box-shadow: inset 0 1px 0 rgba(255,255,255,0.6), 0 4px 24px rgba(0,0,0,0.5)`.

### Phase Headers
Each phase transition should animate the header card dropping in from above (`translateY(-40px) → 0`, `opacity 0 → 1`, 300 ms ease-out). Use a CSS class `.phase-enter` toggled on phase change.

### Argument Phase
- Replace the plain `<div id="side-badge">` with a character avatar (fox or bear thumbnail, ~40×40 px) beside the badge text.
- The `<textarea>` should use `font-family: 'Courier Prime', monospace` — feel like typing a witness statement.

### Reveal Phase
- Argument cards flip in one by one with a CSS 3D card-flip animation (Y-axis, 400 ms, 80 ms stagger between cards).
- The contempt section uses the gavel slam illustration (Prompt 6) as a `30px` inline image before the heading text.

### Score Rows
- Scores animate their number counting up from 0 using a JS counter loop (`requestAnimationFrame`), ~600 ms duration, on phase entry.

### Connecting Overlay
- Replace "Connecting…" text with a small animated version of the Court Clerk mouse character (CSS sprite or GIF), scribbling furiously.

---

## Motion Budget

| Effect | Trigger | Duration | Notes |
|---|---|---|---|
| Parallax layers | scroll / load | continuous | 60 fps via `requestAnimationFrame` |
| Dust motes float | ambient | 6–10 s loop | CSS `@keyframes`, staggered delays |
| Phase header drop | phase change | 300 ms | `ease-out` |
| Argument card flip | reveal entry | 400 ms + 80 ms stagger | CSS 3D transform |
| Score count-up | reveal / final | 600 ms | `requestAnimationFrame` |
| Character avatar slide | argument phase | 200 ms | `ease-out` |

All animations respect `@media (prefers-reduced-motion: reduce)` — set `animation-duration: 0.01ms` and skip parallax scroll binding.
