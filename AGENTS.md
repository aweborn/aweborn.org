# Aweborn agent rules

## Design standard: portrait phone first, then desktop (Alex, 2026-10-20)

More and more people hold a phone upright. Aweborn has to win them first,
then win everyone at a desk. **Every UI change is designed for a portrait
phone first and checked there before it's called done.** Desktop is the
second pass, and it still has to look great: it's not an afterthought.

### Reference viewports

| Role | Size (CSS px) | Notes |
| --- | --- | --- |
| **Primary: portrait phone** | **390 × 844** | iPhone 14/15 class; design here first |
| Small phone (must not break) | 360 × 740 | Android baseline; nothing clipped or overlapping |
| Landscape phone (must work) | 844 × 390 | Short height: panels scroll, HUD doesn't cover the view |
| Desktop | 1440 × 900 and Alex's 1728 × 998 | Second pass: use the room, don't just stretch |

### Rules for portrait

1. **Thumb zone.** Primary actions sit in the bottom third, within reach of
   one thumb. Rarely used or destructive controls go up top or into a menu.
2. **Touch targets ≥ 44 × 44 px**, with ≥ 8 px between neighbours. No
   hover-only affordances: anything revealed on hover must also be reachable
   by tap.
3. **Safe areas.** Respect `env(safe-area-inset-*)` on every fixed element
   (notch, home bar). Use `dvh`/`svh`, not `100vh`, for full-height layouts.
4. **One column, no sideways scroll.** Width is `min(Npx, 100vw - 32px)`
   style; never a fixed width wider than 360 px. Long text wraps.
5. **Panels become sheets.** Side panels on desktop become bottom sheets or
   full-screen overlays on a phone; they never sit on top of the joystick or
   the action buttons (`html.touch-ui`), and they close with a visible button,
   not just Esc.
6. **The world stays visible.** HUD chrome on a phone covers at most ~25% of
   the screen while playing. Collapse secondary chips into one menu.
7. **Readable type.** Body ≥ 14 px, inputs ≥ 16 px (stops iOS zoom on focus),
   enough contrast over a moving 3D scene (glass + shadow, not bare text).
8. **Keyboard hints are desktop-only.** `<kbd>` labels hide on touch; touch
   gets the equivalent button or gesture.
9. **The on-screen keyboard.** When an input is focused, the field and its
   submit button stay visible above the keyboard (`visualViewport` / `dvh`).
10. **Performance is design.** A mid-range phone must hold a smooth frame rate
    at the default quality tier; heavy effects are opt-in.

### Then desktop

- Use the extra room: side panels instead of sheets, more of the world in
  view, keyboard shortcuts with visible `<kbd>` hints, hover states.
- Same features, same reach: nothing exists only on desktop or only on phone
  unless it's inherently device-specific (e.g. mouse look, gyro).

### Verify before calling UI work done

1. Open the page at **390 × 844** (browser subagent: resize the window, or
   DevTools device mode with touch). Screenshot it. Check rules 1–9.
2. Check **360 × 740** and **844 × 390** for clipping and overlaps.
3. Then **desktop** (1440 × 900 or 1728 × 998). Screenshot it.
4. Mention in the session log / summary which sizes were checked. If a check
   couldn't be run, say so plainly instead of implying it passed.
