## Style Mode — Live AI Styling for Any Page

Style Mode lets you ask the sidebar to “make it funkier” and see the page restyled instantly, without changing the site’s code. It works on most websites, including React/Vue/Next.js apps and Tailwind-heavy pages.

### What it does
- Captures the current page context (URL, text; screenshot if available)
- Sends your prompt to the configured LLM with a CSS-only system instruction
- Applies the returned styles in three layers to maximize reliability:
  1) Stylesheet injection (Electron `insertCSS`)
  2) DOM `<style>` tags in document, Shadow DOMs, and same-origin iframes
  3) Inline-style applier: parses CSS and sets `element.style.setProperty(..., 'important')` on matched elements
- Keeps styles applied across dynamic updates using `MutationObserver`
- Lets you quickly revert with “Reset styles”

### How to use
1. Open the sidebar (⌘E).
2. Toggle “Style mode”.
3. Type a prompt like “make it funkier” or “use a warm pastel palette with larger headings”.
4. Watch styles apply live. Click “Reset styles” to revert.

### Where the code lives
- Main logic:
  - `src/main/LLMClient.ts`
    - Builds system prompt for style mode
    - Streams LLM response and injects CSS (stylesheet → DOM → inline)
    - Shadow DOM and iframe support, observers, and reset
- Sidebar UI:
  - `src/renderer/sidebar/src/components/Chat.tsx`
    - “Style mode” pill, “Reset styles” button
- Context & IPC:
  - `src/renderer/sidebar/src/contexts/ChatContext.tsx` — sends `styleMode` and message
  - `src/preload/sidebar.ts` and `src/preload/sidebar.d.ts` — typed bridge (chat + reset)
  - `src/main/EventManager.ts` — handler for `clear-style-injection`

### System prompt (style mode)
LLM is instructed to output ONLY raw CSS (no `<style>` tags, no markdown fences), targeting existing elements/classes. The prompt emphasizes tasteful, non-destructive changes (colors, spacing, typography), and discourages heavy animations.

### Injection strategy (in order)
1) Stylesheet injection
   - `webContents.insertCSS(css, { cssOrigin: 'user' })`
   - We transform CSS to increase precedence:
     - Prefix selectors with `:root[data-ai-style-scope] …`
     - Add `!important` to declarations (except at-rules and comments)
   - We set `data-ai-style-scope="1"` on `<html>` so selectors win against utility classes.

2) DOM `<style>` tags (fallback/augment)
   - Injected into `document.head`
   - Also injected into existing ShadowRoots and same-origin iframes
   - MutationObserver attaches styles to newly added ShadowRoots/iframes when Style mode is on

3) Inline-style applier (last resort)
   - Parses the CSS returned by the LLM
   - For each selector match, applies each declaration as inline styles with `!important`
   - Mimics DevTools behavior so it usually wins against Tailwind/utilities/late loads

### Reset behavior
- Removes inserted stylesheet (tracks insertCSS key)
- Removes all `<style data-ai-style>` tags from document, ShadowRoots, and iframes
- Disconnects observers (`__aiStyleObserver__`, `__aiInlineObserver__`)
- Removes `data-ai-style-scope` from `<html>`

### Supported apps and caveats
- Works on: SSR/CSR SPAs, React/Vue/Next.js, Tailwind, CSS Modules, CSS-in-JS
- Shadow DOM: supported (existing and newly added via observer)
- Iframes: same-origin only (cross-origin is isolated by the browser)
- CSP: `insertCSS` typically works even with strict CSP; inline `<style>` may be blocked on some sites
- Canvas/WebGL/SVG-heavy UIs: CSS has limited effect

### Troubleshooting
- “No visible changes”
  - Try a stronger prompt (e.g., “increase heading size and accent colors”)
  - Page may be Canvas/WebGL; CSS cannot restyle pixels
  - Check DevTools Elements → Styles to confirm inline styles are applied

- “Changes flicker or revert on SPA routes”
  - Style mode uses observers to re-apply; keep Style mode enabled while exploring the page
  - Use “Reset styles” before trying a different direction

### Configuration
- LLM provider/model via `.env` (see `LLMClient.ts`):
  - `LLM_PROVIDER=openai|anthropic|gemini`
  - `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`

### Security considerations
- We never inject scripts from the LLM. The style mode prompt enforces CSS-only output.
- Returned CSS is sanitized to strip markdown fences and `<style>` wrappers before use.

### Extending the feature
- Add presets (e.g., “Minimal”, “Neon”, “Newspaper”) that prepend design directions to the prompt
- Expose intensity slider to scale changes (font sizes, border radii, shadows)
- Allow exporting the final applied CSS as a snippet

---
If anything seems off or a site doesn’t change, open the console and share logs from `LLMClient` and the renderer; we’ll improve the selectors or add a site-specific tweak.


