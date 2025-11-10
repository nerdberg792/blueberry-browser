export function parseJsonFromText(text: string): unknown | null {
  if (!text) return null;
  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const candidate = trimmed.slice(firstBrace, lastBrace + 1);
  const embedded = tryParse(candidate);
  if (embedded !== undefined) {
    return embedded;
  }

  return null;
}

function tryParse(payload: string): unknown | undefined {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}


