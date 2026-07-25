(() => {
  if (globalThis.__justReadItInjected) return;
  globalThis.__justReadItInjected = true;

  const MAX_TEXT_LENGTH = 60_000;
  const BLOCK_SELECTOR = "h1, h2, h3, p, li, blockquote, figcaption";
  const BOILERPLATE_SELECTOR = [
    "nav",
    "header",
    "footer",
    "aside",
    "form",
    "dialog",
    "[role='navigation']",
    "[role='banner']",
    "[role='contentinfo']",
    "[aria-hidden='true']"
  ].join(",");

  function clean(text) {
    return String(text ?? "")
      .replace(/\u00ad/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n+ */g, "\n")
      .trim();
  }

  function visible(element) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function extractSelection() {
    return clean(globalThis.getSelection?.().toString());
  }

  function extractPage() {
    const root = document.querySelector("article, main, [role='main']") ?? document.body;
    const seen = new Set();
    const blocks = [];

    for (const element of root.querySelectorAll(BLOCK_SELECTOR)) {
      if (element.closest(BOILERPLATE_SELECTOR) || !visible(element)) continue;
      const text = clean(element.innerText);
      const minimum = /^H[1-3]$/.test(element.tagName) ? 2 : 18;
      if (text.length < minimum || seen.has(text)) continue;
      seen.add(text);
      blocks.push(text);
    }

    const result = clean(blocks.length ? blocks.join("\n") : root.innerText);
    return result.slice(0, MAX_TEXT_LENGTH);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== "content" || message.type !== "EXTRACT_TEXT") return;

    const text = message.mode === "selection" ? extractSelection() : extractPage();
    sendResponse({ ok: Boolean(text), text, error: text ? null : "No readable text found." });
  });
})();
