# Accessibility and mobile audit: web replay

- **Scope:** `web/` replay of the real event in `web/public/event.json` (2024-06-21 benzene, Houston Ship Channel): Detect, Trace, Check, Packet, the "What this can't say" panel, approve + file dialog, EN/ES toggle, read aloud.
- **Standard:** WCAG 2.2 AA. Touch targets held to 44 x 44 CSS px on mobile, which is stricter than the AA minimum (2.5.8 asks for 24 px; 44 px is AAA 2.5.5).
- **Date:** 2026-11-14. Audited at `01e6a75`. The fixes were rebased onto `aac7e09` (lazy-loaded map, Gemini drafter) and checked again there: Lighthouse 100/100, reflow at 320x256, Trace tab stops.
- **Viewports:** 375x812 (mobile, touch, DPR 2) and 1440x900. Also 812x375 (phone landscape) and 320x256 (1280x1024 at 400% zoom).
- **Tools:** Chrome 157 DevTools (Lighthouse accessibility category, accessibility tree snapshot, emulation of reduced motion and forced colors). axe-core 4.10.2 injected from cdnjs in a DevTools snippet, run on every step. `npx @axe-core/cli` did not run: its bundled ChromeDriver supports only Chrome 152 and the fix is a browser download, which I skipped. Contrast ratios computed by script from the CSS and `EventMap.tsx` color constants. Keyboard path driven with real key events (Tab, arrows, Enter, Escape).

## Scores

| | 375x812 | 1440x900 |
|---|---|---|
| Lighthouse accessibility, before | 100 | 100 |
| Lighthouse accessibility, after | 100 | 100 |
| axe violations (all steps), before | 1 (`landmark-unique`) | 1 (`landmark-unique`) |
| axe violations (all steps), after | 1 (`landmark-unique`, out of lane) | 1 (`landmark-unique`, out of lane) |

Lighthouse in navigation mode only sees the Detect step on first load, and it found no failures. That 100 missed every Serious finding below. Two of them (the step panel shrinking to 0 px, and the focusable canvas with no focus ring) only show up through manual testing.

## Findings

Severity is about the effect on users: **Critical** blocks the task, **Serious** is a major barrier, **Moderate** is a workaround exists, **Minor** is friction. The "Fixed" column refers to this branch.

| # | Severity | WCAG | Where | Evidence | Suggested fix | File | Fixed |
|---|---|---|---|---|---|---|---|
| 1 | Serious | 1.4.10 Reflow (AA) | Whole app below 1024 px wide when the viewport is short | At 320x256 (400% zoom) the step panel is **0 px** tall (`.panel` 330..330). Header 90 + map `min-height: 240px` already fill the screen. At 812x375 (phone landscape) the panel is 83 px, of which the stepper takes 60, so 23 px of content shows. None of the four steps can be reached. | On short, narrow viewports, drop the fixed-height app shell: let the page scroll, shrink the map to about 60% of the viewport height, and keep the stepper sticky. | `App.css` | yes |
| 2 | Serious | 2.4.7 Focus Visible (AA), 4.1.2 Name, Role, Value (A) | Map: deck.gl overlay `<canvas id="deckgl-overlay" tabindex="0">` | Tab order: map canvas, then **an unnamed canvas with an inline `outline: none`**, then 4 attribution links. Keyboard users land on an invisible stop that does nothing (deck has `controller: false`). | Take it out of the tab order: set `tabIndex = -1` on deck's canvas after creating it, or pass a canvas with `tabindex="-1"`. | `EventMap.tsx` | no (out of lane) |
| 3 | Moderate | 2.4.1 Bypass Blocks (A, met by landmarks), 2.4.3 Focus Order | Trace list: all 40 `<li tabIndex=0>` | 40 tab stops sit between the stepper and "Next: Check". On a phone with a keyboard or switch control, that is 40 presses to move on. | Roving tabindex: the list is one tab stop, and the arrow keys plus Home/End move between facilities. The hint text names the keys. | `Steps.tsx` | yes |
| 4 | Moderate | 1.3.2 Meaningful Sequence / usability | `.sr-only` inside the scrolling `.panel` | `.sr-only` is `position:absolute` without a positioned ancestor, so on Check and Packet it sits at its static spot about 1500 px down and makes the *document* scrollable (`scrollHeight` 1523 vs 812). `scrollIntoView` (as screen readers and find-in-page use) scrolled the page 516 px and pushed the header and map off screen. | Make `.panel { position: relative }` so hidden text stays inside the panel's own scroll box. | `App.css` | yes |
| 5 | Moderate | 4.1.2 Name, Role, Value (A) | Packet: "Read aloud" / "Stop reading" and "Approve this draft" / "Approved (press to undo)" | Both buttons change their label **and** set `aria-pressed`. A screen reader says "Stop reading, toggle button, pressed": the state is stated twice and the meaning is backwards. | Keep the changing label and drop `aria-pressed` (APG: a toggle button's label must not change). | `Steps.tsx` | yes |
| 6 | Moderate | 4.1.3 Status Messages (AA) | Packet: editing the draft after approving it | `onChange` quietly sets `approved=false`, which disables "File with regulator". The cause is only shown in the `aria-describedby` hint, which nothing announces. A screen reader user typing in the textarea is not told their approval was withdrawn. | Announce it through the existing polite live region: "Draft edited. Approve it again before filing." | `Steps.tsx` | yes |
| 7 | Moderate | 2.2.2 Pause, Stop, Hide (A) | Map: pulsing ring on the trigger monitor | The `infinite` animation starts on its own, runs more than 5 s alongside other content, and has no pause control. `prefers-reduced-motion: reduce` is honored (checked: `animation: none`, static ring at 1.6x), but 2.2.2 also covers users who have not set that preference. | Stop after 2 cycles (3.6 s). Afterwards the ring stays as a static marker. | `App.css` | yes |
| 8 | Moderate | 1.4.11 Non-text Contrast (AA), 1.3.3 Sensory Characteristics | Legend in forced-colors mode (Windows High Contrast) | Emulated `forced-colors: active`: all six legend swatches become identical outlined circles, but the map canvas keeps its colors. The legend can no longer be matched to the map. | `forced-color-adjust: none` on `.lg` swatches, so they keep the same colors as the canvas they describe. | `App.css` | yes |
| 9 | Minor | 1.4.1 Use of Color (A) | Stepper in forced-colors mode | The selected tab is shown only by bold text and an underline the same color as the stepper border. The number badge's fill disappears. | In `forced-colors: active`, fill the selected `.step-num` with `Highlight`. | `App.css` | yes |
| 10 | Minor | 2.5.5 Target Size (AAA; project bar 44 px) | EN/ES toggle buttons | 85x**40** px. | `min-height: 44px`. | `App.css` | yes |
| 11 | Minor | 2.5.5 Target Size (AAA; project bar 44 px) | "Show all 24 hourly values" summary, "Nearby, outside the corridor" summary | 343x**32** px; the outside summary is unstyled, about 20 px. | `min-height: 44px`. | `App.css` | yes |
| 12 | Minor | 2.5.5 Target Size (AAA; project bar 44 px) | Check: "Open the state record" link | 159x**19** px, standing alone on its own line. | Give it a class and a 44 px tall hit area. | `Steps.tsx`, `App.css` | yes |
| 13 | Minor | 1.3.1 Info and Relationships / landmark-unique (axe best practice) | `.map-wrap` section and MapLibre's canvas `role="region"` | Two regions share the same name ("Map of monitors and facilities…"), and MapLibre's `Map.Title` locale string repeats the visible heading. The `.map-canvas` div also has `aria-labelledby` without a role (axe `aria-prohibited-attr`, needs review). | Give the canvas a distinct, shorter title (for example "Interactive map; arrow keys pan, plus and minus zoom") and drop `aria-labelledby` from the `.map-canvas` div. | `EventMap.tsx`, `App.tsx` | no (out of lane) |
| 14 | Minor | 2.4.1 Bypass Blocks (A, met by landmarks) | Page start | Keyboard order: map canvas, deck canvas, 4 attribution links, then the steps. There is no skip link. The landmarks technically meet 2.4.1, but sighted keyboard users don't navigate by landmark. | Add a "Skip to steps" link as the first focusable element, pointing at the `aside`. | `App.tsx` | no (out of lane) |
| 15 | Minor | 2.5.8 Target Size (AA, inline exception applies) | Map attribution links | 12 px tall. They pass through the inline-text exception. | Leave as is, or raise `.maplibregl-ctrl-attrib` line-height on mobile. | `App.css` | no (passes AA) |
| 16 | Minor | 1.4.11 Non-text Contrast (AA) | Map: facility dot outside the corridor `rgb(140,140,150)` | 2.99:1 against Positron land `#f2f3f0` (needs 3:1). It has a white stroke, and the Trace list carries the same data. This event has 0 outside facilities. | Darken to about `rgb(120,120,130)` (3.9:1). | `EventMap.tsx` | no (out of lane) |
| 18 | Serious (latent) | 1.4.10 Reflow / robustness | `EventMap` `fit()` and the missing error boundary | Found while fixing #1: when the map is shorter than legend height + 76 px of `fitBounds` padding, MapLibre throws `Invalid LngLat object: (NaN, 90)`. With no error boundary, React unmounts everything and the page goes **blank**. The 240 px map floor in `App.css` avoids it today. Any layout change that shrinks the map brings it back. | Clamp the padding to the map size in `fit()` (or skip `fitBounds` when the box is negative), and add an error boundary around `EventMap` so a map failure leaves the steps usable. | `EventMap.tsx`, `App.tsx` | no (out of lane; avoided via CSS) |
| 17 | Minor | 1.4.4 / readability | Map labels at 375 px | Standing labels and numbered dots overlap in the dense part of the corridor ("37. Ineos…" sits over dots 3 and 4). Every name is still in the Trace list, so it is not a barrier. | Add collision handling (deck `CollisionFilterExtension`) or label only the matched facility on narrow maps. | `EventMap.tsx` | no (out of lane) |

### Not an a11y finding, but flagged

- **Switching language keeps approval.** Approve the English draft, switch to Español, and "File with regulator" stays enabled with the Spanish text, which nobody has reviewed. The comment in `Packet` says "Approval covers the exact text a person read", so the code doesn't do what the comment says. Not changed here because it's a product decision: per-language approval, or reset on switch. `Steps.tsx`.

## Checked and passing

- **Contrast (1.4.3, 1.4.11):** every text color passes. Computed values:
  - Status chips: 7.8–9.7:1 (Reported 8.15, Not yet reported 7.76, No report after deadline 8.12, Mismatch 8.49, Search incomplete 9.71).
  - Map labels on the 92%-white label background, over the darkest basemap water: text 17.7, trigger 5.9, monitor 6.4, matched 6.2, corridor label 9.1.
  - White numerals on facility dots: 13.7 (corridor), 6.4 (matched).
  - Body and UI text: `--ink-2` 9.65; primary button 6.39; disabled button 4.80; fixture banner 11.9.
  - The focus ring `#0b57d0` is 6.39:1 on white.
- **Status without color (1.4.1):** every status chip has its own icon and text ("Reported", "Not yet reported" …). Corridor membership in "Other reports filed that day" is spelled out. The matched facility gets "Filed report #…" text as well as the green border.
- **Reduced motion:** `prefers-reduced-motion: reduce` stops the pulse (computed `animation-name: none`).
- **Keyboard:**
  - The stepper is a correct APG tablist: roving tabindex; Left/Right/Up/Down/Home/End; `aria-selected`; `aria-controls`.
  - "Next" and "Back" move focus to the new tab.
  - The dialog opens with focus on "Got it". Escape closes it, and focus goes back to "File with regulator".
  - No keyboard traps found. Every stop except the deck canvas shows a 3 px focus ring.
- **Headings:** h1 event title → h2 map label (sr-only) → h2 step title → h3 subsections. Nothing is skipped. The dialog has its own h2.
- **Landmarks:** `header`, `main`, labelled map `section`, `aside "Event steps"`, `tabpanel`, `nav "Step navigation"`.
- **Map text alternative:** the map is named and points to the Trace step. The Trace list carries every corridor facility with name, distance, bearing, wind alignment, and source. The Detect sparkline has a full `aria-label` summary plus a 24-row table.
- **Language:** `<html lang="en">`; the textarea and the Español button switch `lang`. Read aloud picks a voice for `es-US`/`en-US`.
- **Forms:** the textarea has a visible `<label>`. The disabled File button has `aria-describedby` hint text. Copy success and failure go through a polite live region.
- **Reflow at 375 px:** no horizontal scroll (`scrollWidth` 375).

## Could not test

- **Real screen readers.** I had no VoiceOver, NVDA, JAWS, or TalkBack session. Screen reader behavior was inferred from Chrome's accessibility tree, and finding 5 is a prediction from the APG and the tree, not a recording. Before calling this AT-compatible, run VoiceOver on iOS Safari through the four steps and the dialog.
- **Real devices.** Touch and viewport results come from Chrome device emulation, not an iPhone or Android phone. Safari's `dvh` and dynamic toolbar behavior is untested.
- **Windows High Contrast** was emulated (`forced-colors: active`), not run on Windows.
- **Voice control** (Voice Control, Dragon) was not tested. Every control has visible text matching its accessible name, which is what those tools need.
- **Speech output.** I checked only that read aloud starts and stops and switches language. I did not listen to how the Spanish voice pronounces the text.
- **Map basemap colors** for contrast are assumed from the Positron style (land `#f2f3f0`, water about `#c2c8ca`), not sampled tile by tile.
- **The axe CLI** did not run (ChromeDriver 152 vs Chrome 157); the same axe-core rules ran in-page.

## After the fixes

Fixed on this branch: #1, #3–#12. Each fix was re-checked in the browser:

| Check | Before | After |
|---|---|---|
| Step panel height at 812x375 (phone landscape) | 83 px (23 px of content) | page scrolls; panel 4948 px, stepper sticks at top |
| Step panel height at 320x256 (400% zoom) | 0 px | page scrolls; panel 817 px, no horizontal scroll |
| Document overflow on Check / Packet at 375x812 | about 700 px (`scrollHeight` 1523) | 0 px |
| Tab stops in the Trace panel | 44 (40 list items + 4) | 5; arrows/Home/End move inside the list; Shift+Tab goes back to the last facility |
| Touch targets under 44 px inside the step panel (all steps, 375 px) | 4 (EN, ES, hourly summary, record link) | 0 |
| Pulse ring after 4.5 s | still animating | 0 running animations; static ring at 1.6x, opacity 0.9 |
| Legend in forced colors | 6 identical outlined circles | swatches match the map colors; selected step number filled with `Highlight` |
| "Read aloud" while speaking, accessibility tree | `button "Stop reading" pressed` | `button "Stop reading"` |
| Edit an approved draft | nothing announced | live region: "Draft edited. Approve it again before filing." |
| Lighthouse accessibility (navigation, Detect step) | 100 / 100 | 100 / 100 |
| axe-core 4.10.2, every step, both sizes | `landmark-unique` x1 | `landmark-unique` x1 (needs `EventMap.tsx`/`App.tsx`) |
| `npm run build`, `npx oxlint` | n/a | both pass (exit 0) |

Still open, and not this lane's to fix: #2 (deck canvas focus stop), #13 (duplicate map region name), #14 (skip link), #16 (outside-corridor dot contrast), #17 (map label overlap), #18 (fitBounds throws and blanks the app). Also the language-switch approval question above.
