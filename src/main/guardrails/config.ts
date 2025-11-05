export interface GuardrailConfig {
  minContrast: number;
  minOpacity: number;
  minFontPx: number;
  minBoxWidth: number;
  minBoxHeight: number;
  minBoxArea: number;
  maxNodeChars: number;
  confidenceCutoff: number;
  semanticWhitelist: string[];
  suspiciousTags: string[];
  cssBlockedProps: string[];
  cssSuspiciousProps: string[];
}

export const defaultGuardrailConfig: GuardrailConfig = {
  minContrast: 4.5,
  minOpacity: 0.8,
  minFontPx: 9,
  minBoxWidth: 2,
  minBoxHeight: 2,
  minBoxArea: 12,
  maxNodeChars: 800,
  confidenceCutoff: 70,
  semanticWhitelist: [
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "td",
    "caption",
    "summary",
  ],
  suspiciousTags: ["span", "div", "i", "b", "em", "strong"],
  cssBlockedProps: [
    "display:none",
    "visibility:hidden",
    "color:transparent",
    "clip:",
    "clip-path:",
    "transform:scale(0)",
    "filter:blur",
  ],
  cssSuspiciousProps: [
    "mix-blend-mode:",
    "text-shadow:",
    "filter:",
  ],
};


