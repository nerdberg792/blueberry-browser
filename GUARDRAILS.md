# Visual Guardrails for Safe Webpage Text Extraction (v1)

## Purpose
Prevent prompt-injection attempts via visually hidden or obfuscated webpage text by filtering DOM text before it is included in LLM prompts. This focuses on visual/CSS defenses, rendering checks, content sanitization, optional OCR consensus, and operational controls.

## Core Principles
- Only include text the user can reasonably see and read.
- Prefer deterministic, explainable heuristics with reason-coded logging.
- Default-safe thresholds with configurable overrides.

## Rules & Thresholds
- Contrast (WCAG 2.x): discard if contrast < 4.5:1. Mark 3–4.5 as suspicious.
- Opacity: discard if element or color alpha < 0.8.
- Font size: discard if computed font-size < 9px (0px is blocked).
- Visibility/Display: display:none, visibility:hidden, color:transparent → blocked.
- Off-screen: positioned entirely outside viewport → blocked.
- Clipping/Masks/Transform: clip/clip-path, transform:scale(0) → blocked.
- Filters/Blending: filter: blur(...) → blocked; mix-blend-mode → suspicious.
- Bounding box: getBoundingClientRect() width & height > 2px and area ≥ 12px².
- Overlay check: elementFromPoint(center) should be the element or its descendant.
- Content heuristics: max 800 chars per node; reject nodes with zero‑width/bidi overrides; prefer semantic elements (p, h1..h6, li, td, caption, summary).
- Confidence score: 0–100. Only send nodes with confidence ≥ 70.

## Pipeline
1) DOM Collector: TreeWalk visible text nodes under semantic containers; allow other containers with lower prior.
2) Visual/CSS Checks: computed style, contrast, opacity, size, position, clipping, overlay.
3) Content Heuristics: unicode/bidi/zero-width filters, length limits, normalization.
4) Scoring & Policy: combine checks into confidence; enforce cutoffs; maintain allow/deny lists.
5) Optional OCR Consensus: run tesseract.js at multiple scales, require ≥2/3 agreement per line; only add OCR‑only lines with high consensus and no DOM conflicts.
6) Logging: record excluded nodes with reason codes, selector, truncated sample hash.

## Success Criteria (v1)
- ≥95% exclusion on crafted hidden-text tests; ≤1% false-positive drop on representative pages.
- Complete audit log of excluded nodes with reasons.

## Configuration (defaults)
- minContrast: 4.5
- minOpacity: 0.8
- minFontPx: 9
- minBox: width ≥ 2, height ≥ 2, area ≥ 12
- maxNodeChars: 800
- confidenceCutoff: 70
- semanticWhitelist: p,h1..h6,li,td,caption,summary
- cssBlacklist: display:none, visibility:hidden, color:transparent, clip/clip-path, transform:scale(0), filter:blur(...)

## Operational Controls
- Telemetry: counts per reason, exclusion rate, top reasons; hash/truncate text in logs by default.
- Red-team Suite: low-contrast, transparent text with shadow, off-screen, tiny font, zero-width payload, overlay attacks.
- Tuning Lever: enterprise config to tighten/loosen thresholds; debug mode exposes suppressed content.

## Notes
- WCAG 2.x formulas used for contrast computations.
- OCR is optional and off by default in general deployments; enable for vision‑augmented agents.


