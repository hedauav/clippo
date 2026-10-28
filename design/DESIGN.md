# Clippo — Visual Direction ("The Clipping Desk")

Clippo is a trade-paper clipping bureau that happens to settle in USDC. Every screen is a page of a newspaper's classifieds and a bookkeeper's ledger: paper, ink, hairlines, stamps, margin notes. One hot accent marks money and action. Nothing floats, glows, or rounds.

## Anti-goals (hard bans)
No purple/blue gradients, glass, blur, drop-shadow cards, emoji, lucide-in-a-circle, centered hero + 3 feature cards, uniform rounded-xl grids, Inter/Roboto/Space Grotesk/Geist, shadcn defaults, fake testimonials/stats, "Supercharge / Seamless / Unlock". Border radius is 0 everywhere except the stamp (2px) and the avatar-less initials plate (0). Shadows: none. Depth comes from hairlines, offset "ink-block" hard shadows on primary buttons only (4px 4px 0 ink, no blur), and paper tone shifts.

## Typography
| Role | Family (next/font/google) | Use |
|---|---|---|
| Display | **Bodoni Moda** (opsz axis, 500/700, italic) | Headlines, big numbers in hero, campaign titles. Tight tracking (-0.02em), line-height 0.95-1.05. Italic for the one emphasised word per headline. |
| Text | **Schibsted Grotesk** (400/500/700) | Body, labels, buttons. Newspaper-derived grotesk, not neutral-SaaS. |
| Figures | **Martian Mono** (400/500/700) | All money, views, rates, addresses, IDs, stamps, table figures. Tabular, wide. Uppercase + 0.08em tracking for micro-labels. |

Scale (rem, fluid via clamp on display only): micro 0.6875 (mono caps), small 0.8125, body 1.0 / lh 1.55, lead 1.25, h3 1.5, h2 2.25, h1 clamp(2.75, 7vw, 6.5) display. Max measure 64ch. Numbers in tables are right-aligned mono.

## Palette (CSS tokens, light = "paper")
| Token | Light | Dark ("press room, night shift") |
|---|---|---|
| --paper | #F1ECE0 | #12100D |
| --paper-2 (raised/slip) | #F8F5EC | #1A1713 |
| --paper-3 (wash/table band) | #E7E0D0 | #221E18 |
| --ink | #15120E | #EDE6D6 |
| --ink-2 (secondary text) | #4A443A | #B5AC99 |
| --ink-3 (tertiary/disabled, >=4.5:1 on paper for text use) | #6B6455 | #8F8775 |
| --rule | #15120E at 100% hairline 1px; --rule-soft #15120E26 | #EDE6D6 / #EDE6D622 |
| --signal (the one accent) | #E8420C hot orange-vermilion | #FF5A1F |
| --signal-ink (text on signal) | #FFF8EE | #12100D |
| --ok (approved stamp) | #1D5C3A | #5DBB8A |
| --no (rejected stamp) | #9B1C1C | #E2685F |
| --hold (needs human stamp) | #8A5A00 ochre | #D9A441 |

Contrast: ink on paper ~16:1; signal on paper large-text/graphics only (3.9:1 — never for small body text; use ink text on signal-tinted bars, or signal text >= 18px bold). Focus ring: 2px ink outline + 2px paper gap + signal outer line (visible on both modes).
Paper texture: a 3% SVG feTurbulence noise tile as body background-image (static, inline data URI). No gradients except the stamp-ink "bleed" mask.

## Layout & spacing
- 12-col grid, 1280 max, 24px gutters (16 on phone). Asymmetric: a narrow 3-col "margin" rail (labels, notes, AI reasons) beside a 9-col main column is the default page structure, like a newspaper margin. Rail collapses above the content on phones.
- Spacing scale 4/8/12/16/24/32/48/72/112. Sections are separated by a double rule (1px + 3px gap + 1px) or a thick 3px ink rule, never by padding alone.
- Masthead: wordmark "Clippo" in Bodoni italic with a pair of scissor-slit SVG notch marks; below it a dateline strip in mono ("MON 27 OCT 2026 · ARC TESTNET · POOLS OPEN 14 · USDC") — real values from data, not fabricated.
- Nav is a text row separated by slashes, active item underlined with a 3px signal rule. Wallet chip is a mono "slip" with a corner notch.

## Signature components
1. **Clipping slip** (campaign listing): paper-2 rectangle, no radius, a zig-zag/perforated tear edge on the left or bottom (CSS mask, 6px teeth), a dashed hairline, serial number "No. 0042" in mono rotated in the corner. Title in Bodoni, rate as a big mono figure "$2.40 / 1K views", pool remaining as a ruled ticker bar (a row of 40 tick marks, filled ticks ink, remainder hairline — not a rounded progress pill). Slips are different widths in a masonry-ish asymmetric flow (one 7-col lead, then 5-col, 4-col...).
2. **Ledger** (tables): mono figures, hairline row rules, zebra-free, a heavier rule under header, header set in mono caps, running-balance column, tabular-nums, row hover = paper-3 band. On phone each row reflows into a stacked "receipt" with dotted leaders between label and value.
3. **Stamp** (verdict): rectangle, 2px double border, mono caps 700, rotated -4 to -7deg, slight ink-bleed (SVG turbulence displacement filter, subtle, static), multiply blend. APPROVED (--ok), REJECTED (--no), NEEDS HUMAN (--hold). Confidence shown as mono "CONF 0.91" under it. Stamp "thunks" in once on mount (scale 1.25 -> 1, 160ms, steps easing); respects reduced-motion (no animation).
4. **Margin note**: the AI's reason sits in the left rail in Schibsted italic with a hand-drawn bracket "[" SVG linking to the clip row, prefixed "AGENT NOTE". Appeal button is a text link with a small underline-arrow.
5. **Ticker strip**: a thin ruled band of real-looking recent ledger events (mono, 12px), horizontally scrolled by CSS marquee only on landing; paused on hover/focus/reduced-motion.
6. **Buttons**: primary = signal fill, ink text-on-signal, 2px ink border, hard 4px offset ink shadow; pressed state translates 3px and removes the shadow. Secondary = 2px ink outline, transparent. Tertiary = underlined text. Min hit 44px.
7. **Choice cards** (wizard): large rectangular option "tickets" with a mono index (A / B / C), title, one dry sentence; selected = ink fill, paper text, a notch punched on the right edge. Keyboard: radio-group semantics, arrow keys.
8. **Inputs**: bottom-rule only (form-on-paper), label in mono caps above, hint below; error = oxblood rule + message with an SVG "x-in-square" glyph.
9. **Icons**: hand-drawn inline SVG, 24px grid, 1.5px stroke, square caps, mitre joins, slightly off-grid endpoints so they feel inked. Set: scissors, link, stamp, check-mark (scratched), flag, coin-stack, bracket, arrow-corner, notch, world-eye (circle + horizontal lens), clock. Never inside tinted circles; they sit bare next to text.
10. **Empty / loading / error**: Loading = ledger rows drawn as ruled lines with a typewriter-style blinking "_" caret and the text "Setting type..." (no grey skeleton blobs). Empty = a blank slip with dashed outline and one dry sentence plus the next action. Error = a "CORRECTION" box (newspaper correction convention): bold mono heading, what failed, what to do, retry link.

## Motion (restrained)
- 120-180ms, `steps()` or `cubic-bezier(.2,.7,.2,1)`. Only: stamp thunk, ticker drift, ledger row insert (translateY 4px + opacity), button press, wizard step cross-cut (new step slides up 12px; old fades 80ms). Number change = digits roll via a short mono flicker is NOT used; numbers just update. `prefers-reduced-motion`: all of the above off.

## Copy voice
Dry, direct, specific, a trade-desk editor. Sentence case. Numbers over adjectives. Say what happens and what it costs.
- Yes: "Pay per 1,000 verified views. You set the rate. Unspent USDC comes back at close." "Rejected: clip never mentions the required disclosure label. Appeal within 7 days." "Waiting on admin. Your 5,000 USDC is in escrow and refundable in full."
- No: "Unlock the power of...", "Seamless", "Supercharge", exclamation marks, "Oops!", emoji, invented metrics. Demo data is labelled as demo data in the dateline ("DEMO LEDGER") whenever mocks are in use.
Section names borrow print vocabulary: Desk (dashboard), Wire (marketplace), Slips (campaigns), Ledger (earnings), Standing (leaderboard), Corrections (errors), Bench (admin).

## Dark mode
Follows `prefers-color-scheme`, with a manual "Paper / Night" toggle (data-theme on <html>, persisted in localStorage in try/catch). Night is warm near-black with cream ink, not blue-black; stamps lighten and keep multiply replaced by `screen`-ish opacity; noise tile inverted at 4%. Signal brightens to #FF5A1F. Hard shadows become a 4px offset in --signal at 40% so the "press" feel remains.

## Accessibility
Semantic landmarks, skip link, labelled controls, visible focus (see above), stamps carry text (never colour-only), tables use proper th scope with reflow on phone, wizard uses fieldset/legend + radio semantics, `aria-live=polite` for async verdict/status changes, minimum 16px input text on mobile, 44px targets.

## Screens (route map)
/ landing (live ledger + stamp mechanism, not marketing) · /wire marketplace + standing · /slips/[id] campaign detail · /desk/new wizard · /desk/[id]/fund fund + pending admin · /desk campaigner dashboard · /join creator onboarding (World ID + bio code) · /ledger earnings/claim · /bench admin · /account.
