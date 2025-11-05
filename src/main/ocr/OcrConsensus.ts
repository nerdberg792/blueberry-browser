// Lightweight OCR consensus wrapper around tesseract.js
// Run multi-scale OCR and return lines that appear in >= 2 passes

import { createWorker } from "tesseract.js";
import { nativeImage } from "electron";

type OcrOptions = {
  lang?: string;
  scales?: number[]; // e.g., [1, 1.5, 2]
};

function normalizeLine(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

export async function ocrConsensusFromDataUrl(dataUrl: string, opts: OcrOptions = {}): Promise<string> {
  const lang = opts.lang || "eng";
  const scales = opts.scales || [1, 1.5, 2];
  const baseImg = nativeImage.createFromDataURL(dataUrl);
  if (baseImg.isEmpty()) return "";

  const lineSets: Array<Set<string>> = [];
  const worker = await createWorker(lang);
  try {
    for (const scale of scales) {
      const size = baseImg.getSize();
      const w = Math.max(1, Math.round(size.width * scale));
      const h = Math.max(1, Math.round(size.height * scale));
      const resized = baseImg.resize({ width: w, height: h });
      const pngBuffer = resized.toPNG();
      const { data } = await worker.recognize(pngBuffer);
      const set = new Set<string>();
      const full = normalizeLine(data.text || "");
      if (full) full.split(/\n+/).map(normalizeLine).filter(Boolean).forEach((t) => set.add(t));
      lineSets.push(set);
    }
  } finally {
    try { await worker.terminate(); } catch {}
  }

  // Consensus: keep lines that appear in >= 2 sets
  const counts = new Map<string, number>();
  for (const set of lineSets) {
    for (const t of set) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const accepted: string[] = [];
  for (const [t, c] of counts) {
    if (c >= 2) accepted.push(t);
  }
  return accepted.join("\n");
}


