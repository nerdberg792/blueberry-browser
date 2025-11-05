export type GuardrailAuditItem = {
  selector: string;
  reason: string[];
  confidence: number;
  sampleHash: string;
  text?: string; // Optional: actual text content for rejected items
  debugInfo?: {
    textColor?: string;
    backgroundColor?: string;
    contrastRatio?: number | null;
  };
};

export class GuardrailLogger {
  logBatch(items: GuardrailAuditItem[], ctx: { tabId?: string | null; url?: string | null } = {}): void {
    const ts = new Date().toISOString();
    for (const it of items) {
      // Log rejected items with their actual text for debugging
      const isRejected = it.reason[0] !== 'accepted';
      const textPreview = it.text ? ` text="${it.text.substring(0, 200)}${it.text.length > 200 ? '...' : ''}"` : '';
      
      // Add contrast debug info if available (especially useful for debugging low_contrast rejections)
      const contrastDebug = it.debugInfo && (it.debugInfo.contrastRatio !== undefined || it.debugInfo.textColor) 
        ? ` contrast=${it.debugInfo.contrastRatio !== undefined && it.debugInfo.contrastRatio !== null ? it.debugInfo.contrastRatio.toFixed(2) : 'null'} textColor="${it.debugInfo.textColor || 'unknown'}" bgColor="${it.debugInfo.backgroundColor || 'unknown'}"`
        : '';
      
      console.log(
        `GUARDRAIL [${ts}] tab=${ctx.tabId || '-'} url=${ctx.url || '-'} sel=${it.selector} conf=${it.confidence} reasons=${it.reason.join(',')} sampleHash=${it.sampleHash}${contrastDebug}${isRejected && textPreview ? textPreview : ''}`
      );
    }
  }
}


