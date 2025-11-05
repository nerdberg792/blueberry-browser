import type { GuardrailConfig } from "./config";

type AuditItem = {
  selector: string;
  reason: string[];
  confidence: number;
  sampleHash: string;
  text?: string;
  debugInfo?: {
    textColor?: string;
    backgroundColor?: string;
    contrastRatio?: number | null;
  };
};

type Result = { safeText: string; audit: AuditItem[] };

function cssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && parts.length < 8) {
    const name = node.nodeName.toLowerCase();
    const id = (node as HTMLElement).id ? `#${(node as HTMLElement).id}` : "";
    let selector = name + id;
    if (!id) {
      const siblings = node.parentElement?.children || [];
      let index = 1;
      for (let i = 0; i < siblings.length; i++) {
        if (siblings[i] === node) {
          index = i + 1;
          break;
        }
      }
      selector += `:nth-child(${index})`;
    }
    parts.unshift(selector);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

function relLuminance(rgb: number[]): number {
  const srgb = rgb.map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function parseColor(input: string): { rgb: number[]; alpha: number } | null {
  if (!input) return null;
  
  // First try to parse RGB/RGBA strings directly (most common case)
  const rgbMatch = input.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
  if (rgbMatch) {
    const r = parseFloat(rgbMatch[1]);
    const g = parseFloat(rgbMatch[2]);
    const b = parseFloat(rgbMatch[3]);
    const a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      return { rgb: [r, g, b], alpha: isNaN(a) ? 1 : a };
    }
  }
  
  // Fallback: use canvas context for other color formats (hex, named colors, etc.)
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000";
    ctx.fillStyle = input;
    const computed = ctx.fillStyle as string;
    // Browser normalizes to rgb(a)
    const m = computed.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
    if (!m) return null;
    const r = parseFloat(m[1]);
    const g = parseFloat(m[2]);
    const b = parseFloat(m[3]);
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return { rgb: [r, g, b], alpha: isNaN(a) ? 1 : a };
  } catch (e) {
    return null;
  }
}

function contrastRatio(fg: string, bg: string): number | null {
  const pf = parseColor(fg);
  const pb = parseColor(bg);
  if (!pf || !pb) return null;
  // Alpha: flatten foreground over background if needed (simple alpha over solid bg)
  const alpha = pf.alpha;
  const rgb = [0, 1, 2].map((i) => Math.round(pf.rgb[i] * alpha + pb.rgb[i] * (1 - alpha)));
  const L1 = relLuminance(rgb);
  const L2 = relLuminance(pb.rgb);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

function getEffectiveBackground(el: Element): string {
  // Start with the element itself, walk up only if background is transparent
  // This finds the actual visible background color the text sits on
  let node: Element | null = el as Element;
  while (node) {
    const cs = getComputedStyle(node);
    const bg = cs.backgroundColor;
    const color = parseColor(bg);
    // Return first solid background (alpha >= 0.8) found, starting from element itself
    if (color && color.alpha >= 0.8) return bg;
    node = node.parentElement;
  }
  // Fallback to white if no solid background found in parent chain
  return "rgb(255, 255, 255)";
}

function hashSample(text: string): string {
  // Simple non-crypto hash for logging (privacy-preserving short fingerprint)
  let h = 2166136261 >>> 0;
  const s = text.slice(0, 120);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/u;

export function buildGetSafeVisibleTextScript(config: GuardrailConfig): string {
  const cfg = JSON.stringify(config);
  return `(() => {
    try {
      const CFG = ${cfg};
      const INV_RE = ${INVISIBLE_RE};
      const cssPath = ${cssPath.toString()};
      const relLuminance = ${relLuminance.toString()};
      const parseColor = ${parseColor.toString()};
      const contrastRatio = ${contrastRatio.toString()};
      const getEffectiveBackground = ${getEffectiveBackground.toString()};
      const hashSample = ${hashSample.toString()};

      const audit = [];
      const accepted = [];

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        let text = node.textContent || '';
        text = text.replace(/\\s+/g, ' ').trim();
        if (!text) continue;
        if (text.length > CFG.maxNodeChars) {
          audit.push({ selector: cssPath(node.parentElement || document.body), reason: ['too_long'], confidence: 0, sampleHash: hashSample(text), text: text });
          continue;
        }
        if (INV_RE.test(text)) {
          audit.push({ selector: cssPath(node.parentElement || document.body), reason: ['invisible_unicode'], confidence: 0, sampleHash: hashSample(text), text: text });
          continue;
        }
        const el = node.parentElement;
        if (!el) continue;

        const tag = el.tagName.toLowerCase();
        const isSemantic = CFG.semanticWhitelist.includes(tag);
        const isSuspicious = CFG.suspiciousTags.includes(tag);

        const cs = getComputedStyle(el);
        const reasons = [];
        let confidence = isSemantic ? 85 : isSuspicious ? 60 : 70;

        if (cs.display === 'none' || cs.visibility === 'hidden') { reasons.push('hidden'); confidence = 0; }
        const opacity = parseFloat(cs.opacity || '1');
        if (opacity < CFG.minOpacity) { reasons.push('low_opacity'); confidence -= 50; }
        if (cs.color && /transparent/i.test(cs.color)) { reasons.push('transparent_color'); confidence = 0; }
        const fontSize = parseFloat(cs.fontSize || '0');
        if (fontSize < CFG.minFontPx) { reasons.push('tiny_font'); confidence -= 40; }
        const rect = el.getBoundingClientRect();
        if (rect.width < CFG.minBoxWidth || rect.height < CFG.minBoxHeight || (rect.width * rect.height) < CFG.minBoxArea) {
          reasons.push('small_box'); confidence -= 25;
        }
        const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
        // Check if element is in viewport (with small buffer for rounding)
        const isInViewport = rect.right >= -10 && rect.bottom >= -10 && rect.left <= vw + 10 && rect.top <= vh + 10;
        // Only reject if intentionally positioned far offscreen (suspicious hiding)
        const isFarOffscreen = rect.right < -100 || rect.bottom < -100 || rect.left > vw + 100 || rect.top > vh + 100;
        if (isFarOffscreen) { 
          reasons.push('offscreen'); 
          confidence = 0; 
        } else if (!isInViewport) {
          // Content below/above fold - no penalty for semantic elements (they're valid page content)
          // Only penalize non-semantic elements outside viewport
          if (!isSemantic) {
            reasons.push('outside_viewport'); 
            confidence -= 15; 
          }
        }
        const cssText = (el.getAttribute('style') || '').toLowerCase();
        if (cssText.includes('clip:') || cssText.includes('clip-path:') || cssText.includes('transform: scale(0)')) { reasons.push('clipped_or_scaled'); confidence = 0; }
        if (/filter\\s*:\\s*blur\\(/i.test(cssText)) { reasons.push('blur_filter'); confidence = 0; }
        if (/mix-blend-mode\\s*:/i.test(cssText)) { reasons.push('blend_mode'); confidence -= 15; }

        // Get the effective background: checks element's own backgroundColor first,
        // then walks up parent tree only if transparent (finds the actual visible background the text sits on)
        const bg = getEffectiveBackground(el);
        const textColor = cs.color || 'rgb(0,0,0)';
        // Compare text color with its effective background color (not parent's background vs element's background)
        const cr = contrastRatio(textColor, bg);
        
        // Debug: log contrast calculation for debugging (only for rejected items to avoid spam)
        // This helps identify false positives where black-on-white text is flagged as low contrast
        
        // Check if element is clearly visible before applying harsh contrast penalties
        const isClearlyVisible = isInViewport && 
          opacity >= CFG.minOpacity && 
          fontSize >= CFG.minFontPx && 
          rect.width >= CFG.minBoxWidth && 
          rect.height >= CFG.minBoxHeight &&
          !(cs.display === 'none' || cs.visibility === 'hidden');
        
        // If contrast calculation failed (null), don't penalize - might be a parsing issue
        // Only penalize if we successfully calculated a low contrast ratio
        if (cr === null) {
          // Contrast calculation failed - could be due to color parsing issues
          // Don't reject, but mark for debugging
          reasons.push('contrast_calc_failed');
          // Only small penalty since we can't verify contrast
          confidence -= 10;
        } else if (cr < CFG.minContrast) { 
          reasons.push('low_contrast'); 
          // Much less harsh penalty for semantic elements that aren't intentionally hidden
          if (isSemantic && cr >= 2.0 && !isFarOffscreen && fontSize >= CFG.minFontPx && opacity >= CFG.minOpacity) {
            // Small penalty for semantic content - they're likely legitimate even with low contrast
            confidence -= isClearlyVisible ? 10 : 15;
          } else if (!isFarOffscreen && fontSize >= CFG.minFontPx && opacity >= CFG.minOpacity) {
            // Medium penalty for other visible content
            confidence -= 30;
          } else {
            confidence -= 40; // Full penalty for suspicious cases
          }
        } else if (cr < 4.5 && cr >= 3) { 
          reasons.push('suspicious_contrast'); 
          confidence -= 15; 
        }

        const cx = rect.left + rect.width / 2; const cy = rect.top + rect.height / 2;
        const topEl = document.elementFromPoint(cx, cy);
        if (topEl && topEl !== el && !el.contains(topEl)) { reasons.push('overlay'); confidence -= 30; }

        // Include debug info for contrast-related rejections
        const debugInfo = (reasons.indexOf('low_contrast') !== -1 || reasons.indexOf('contrast_calc_failed') !== -1) 
          ? { textColor: textColor, backgroundColor: bg, contrastRatio: cr }
          : undefined;
        
        if (confidence >= CFG.confidenceCutoff && reasons.indexOf('hidden') === -1) {
          accepted.push(text);
          audit.push({ selector: cssPath(el), reason: ['accepted'], confidence, sampleHash: hashSample(text) });
        } else {
          // Include text content and debug info for rejected items so we can see what's being hidden
          audit.push({ selector: cssPath(el), reason: reasons.length ? reasons : ['low_confidence'], confidence: Math.max(0, confidence), sampleHash: hashSample(text), text: text, debugInfo: debugInfo });
        }
      }
      return { safeText: accepted.join('\\n'), audit };
    } catch (error) {
      return { 
        safeText: '', 
        audit: [], 
        error: error.message || String(error),
        stack: error.stack || ''
      };
    }
  })()`;
}

export type { AuditItem, Result };


