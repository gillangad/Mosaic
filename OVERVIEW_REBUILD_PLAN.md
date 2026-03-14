# Overview Rebuild Plan (High-Level)

## Goal
Rebuild Overview into a true scaled workspace map that is stable, predictable, and optimized for moving panes.

## Scope
- Create a dedicated Overview layer (separate from live terminal pane DOM).
- Support smooth pan/zoom and accurate scaled layout rendering.
- Support pane move interactions with explicit drop targets.
- Apply changes back to the real layout model only on drop.

## Out of Scope (for first pass)
- Animating every terminal content frame inside Overview.
- Cross-workspace pane movement.
- Complex multi-select operations.

## Chosen Direction
**Option 2: Dedicated Overview Layer**
- Overview is rendered from layout geometry, not the live interactive pane tree.
- Interaction is pointer-driven, with deterministic drag/drop states.

## Milestones

### 1) Geometry + Data Model
- Add layout geometry computation utility:
  - Input: `LayoutNode`, viewport dimensions
  - Output: pane rectangles + split metadata
- Keep this read-only and independent of rendering.

### 2) Overview Scene Component
- Build a dedicated `OverviewCanvas` component.
- Render lightweight pane cards using computed rectangles.
- Add pan/zoom controls and bounds handling.

### 3) Pane Move Semantics
- Define drop zones per pane card:
  - `center` = swap
  - `left/right/top/bottom` = move-and-split
- Add/extend layout operation in `src/core/layout.ts`:
  - `movePane(root, sourcePaneId, targetPaneId, position)`

### 4) Integration
- Wire Overview toggle to mount/unmount `OverviewCanvas`.
- On drop, apply layout mutation and close/keep overview based on UX decision.
- Preserve focused pane behavior after move.

### 5) UX Polish
- Clear visual affordances for drag source and active drop zone.
- Smooth transitions when entering/exiting overview.
- Keyboard escape behavior and reliable cancel states.

### 6) Validation
- Manual testing on Windows/macOS/Linux paths.
- Verify nested split layouts, extreme pane counts, and repeated reorders.
- Confirm no terminal interaction regressions outside overview.

## Success Criteria
- Overview reliably opens as a scaled map of current layout.
- Pan and drag interactions are smooth and conflict-free.
- Pane moves behave predictably for all drop positions.
- No accidental pane swaps/moves due to click/drag ambiguity.
- Works consistently in top-tab and vertical-rail modes.

## Risks
- Geometry mismatch between overview and live layout at edge ratios.
- Interaction complexity for nested splits.
- Regression risk in focus management after mutations.

## Risk Mitigation
- Keep geometry utility pure and testable.
- Gate new behavior behind clear operation functions in layout core.
- Roll out in phases (swap-only first, directional move second).

## Rollout Strategy
1. Ship read-only overview scene (no drag/drop).
2. Enable swap drop zone (`center`) only.
3. Enable directional drop zones.
4. Tune visuals and interaction thresholds.

## Deliverable
A stable, map-like Overview experience that matches Mosaic’s pane workflow expectations and reduces drag/interaction bugs long-term.
