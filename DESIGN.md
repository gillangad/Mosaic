# Mosaic Design Philosophy

## Core Principle

Mosaic should feel like a **precision instrument carved from dark glass** — not a web app wearing a dark theme. Every surface should feel physical, every interaction should feel weighted. Think: spacecraft cockpit, luxury watch face, Leica camera UI.

## Aesthetic Direction

**Obsidian Instrument** — dark, clean, glassy, but restrained. One connected window frame. Motion is crisp and intentional, never flashy. Favor clarity and speed over decorative blur.

### What Mosaic Is Not

- Not a generic dashboard
- Not an Electron app that looks like a website
- Not a dark theme slapped on Bootstrap
- Not a showcase of blur effects and gradients

### What Mosaic Is

- A tool you trust
- A surface that disappears so your terminals can breathe
- Something that feels expensive the moment you open it

## Typography

- **UI chrome**: Geist — tight, engineered, modern but distinctive
- **Monospace / terminals**: JetBrains Mono — excellent legibility
- Headings: tight letter-spacing (`-0.03em` to `-0.04em`)
- Labels: slightly open (`0.01em`), uppercase for section headers (`0.06em`)
- Weight hierarchy: `300` for display, `400` for body, `500` for labels, `600` for emphasis
- Never use Inter, Roboto, Arial, or system fonts for UI text

## Color

### Layered Darkness

Premium dark UIs use layered darkness with subtle warm or cool shifts, not flat gray.

- `void` — the deepest background, the "nothing" behind everything
- `surface` — the primary panel/card layer
- `elevated` — floating panels, dropdowns, overlays (derived from surface + text mix)
- Backgrounds should never be pure black (`#000`) — always carry a subtle hue

### Accent Philosophy

- One **dominant accent** per theme that carries the entire personality
- Workspace accents cycle through 4 roles: product, engineering, research, ops
- Focused elements glow subtly with their accent via `color-mix` tinting on borders and box-shadows
- Accents appear on: active tab indicators, focused pane borders, the "New Pane" button, cursor color, resizer hover

### Border Tinting

Borders use the accent color at low opacity via `color-mix` for focused states:
```css
border-color: color-mix(in srgb, var(--workspace-accent) 30%, rgba(255,255,255,0.12));
```

This makes focused panes glow with their workspace's color rather than a generic white.

## Motion

### Timing Hierarchy

Different elements use different timing to create a sense of weight:

- **Tab switches**: `180ms cubic-bezier(0.22, 1, 0.36, 1)` — snappy with slight overshoot
- **Border/hover states**: `200ms ease` — slightly lazy, feels organic
- **Panel entrances**: `160ms` with `translateY(-4px)` → `translateY(0)` + fade
- **Status pulse**: `1.5s ease-in-out infinite` — subtle scale breathing on busy indicators

### Rules

- Never use `120ms ease-out` — too fast, feels cheap
- Never use `300ms+` — too slow, feels sluggish
- The sweet spot is `180-200ms` for most interactions
- Use `cubic-bezier(0.22, 1, 0.36, 1)` for anything that should feel "snappy"
- Use `ease` for anything that should feel "organic"

## Spatial Composition

### Terminal Panes

- Terminal background matches pane surface — the terminal content bleeds seamlessly into the pane, no visible inner rect
- Focused pane has a 2px accent top-bar, accent-tinted border, and soft outer glow
- Unfocused pane headers dim to `0.85` opacity — focused one pops without harsh borders
- Pane headers are compact (32px), tab text is 11px — tool-like, not dashboard-like

### Layout

- Pane gap padding: 8px — enough breathing room without wasting space
- Border radius: 10px — slightly soft, modern
- Resizer reveals a 2px accent-colored center line on hover — minimal but clear affordance

### Title Bar

- Topbar IS the title bar — no wasted vertical space
- `-webkit-app-region: drag` on the bar, `no-drag` on interactive elements
- Platform-aware padding: 140px right on Windows (for min/max/close), 78px left on macOS (for traffic lights)

## The Workspace Rail

- Vertical gradient from surface → void — gives it depth, feels like a spine
- Workspace tabs shift `translateX(2px)` on hover — subtle life
- Active tab indicator uses workspace accent color, not white
- "WORKSPACES" uppercase label anchors the section
- "New Pane" button fills full width in footer — the visual anchor of the sidebar

## The Settings Panel

- Solid `--bg-elevated` background, never translucent
- Brighter border (`--border-glow`) to separate it from the surface
- Deep shadow: `0 16px 48px rgba(0,0,0,0.6)` — must feel like it floats
- Entrance animation: slide up 4px + fade in 160ms
- Section header in uppercase muted text
- Items have leading icons for scannability
- Active skin shows a ✓ checkmark in accent-signal green
- Shortcut keys render as `<kbd>` with borders — like physical keycaps

## The Empty State

- Not a card — a centered hero composition
- Brand name large (52px), light weight (300), tight tracking (-0.04em)
- Single muted tagline below
- CTA as an accent-outlined pill, not a filled button
- Subtle radial gradient atmosphere behind at 4% accent opacity

## Theme Design

### Requirements for Every Theme

Each theme must have:
- A clear **conceptual identity** (not just "dark with blue")
- A **dominant accent** that carries the personality
- Harmonious terminal colors (not random)
- Consistent contrast ratios for readability

### Current Themes

| Theme | Direction | Dominant Accent |
|-------|-----------|----------------|
| **Carbon** (default) | Warm dark, aged brass | Gold `#c8a44e` |
| **Midnight** | Neutral dark, cool blue | Blue `#7aa2ff` |
| **Ember** | Firelit, burnt warmth | Amber `#e8a735` |
| **Oxide** | Industrial, cold steel | Steel blue `#4a90d4` |
| **Bone** | Warm light, parchment | Leather brown `#8a6840` |

### Rules for New Themes

- Never duplicate the dominant accent of an existing theme
- Dark themes: void should never be pure `#000`, always carry a hue
- Light themes: never use pure `#fff`, always warm or cool shift
- Terminal colors should feel cohesive with the UI palette, not imported from a random scheme
- `bgWell` should match `bgSurface` — terminals bleed seamlessly

## Icons

- No icon library — use Unicode symbols or CSS-drawn icons
- Split buttons use CSS pseudo-elements (outlined box + dividing line)
- Close buttons use `×` (multiplication sign), not `x`
- Settings gear: `⚙`, Overview grid: `⊞`
- Menu items use semantic Unicode: `⊟` layout, `◑` skins, `⌨` shortcuts

## Anti-Patterns

Things to never do:

- Blur effects on panels (use solid elevated backgrounds)
- White borders on dark themes (use `rgba` or `color-mix` at low opacity)
- Hardcoded color values in hover states (use CSS variables and `color-mix`)
- Generic `120ms ease-out` transitions (use the timing hierarchy)
- Flat gray backgrounds without hue (every shade should carry character)
- Cards floating over cards — prefer one continuous surface with subtle layering
- System font stacks for UI text
- Purple gradients on white backgrounds
