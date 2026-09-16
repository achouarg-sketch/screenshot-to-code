const WORDPRESS_ROOT_ID = "stc-wp-export-root";
const LOCAL_ASSET_PATH = "/local-assets/";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read asset"));
    reader.readAsDataURL(blob);
  });
}

function isPortableLocalAssetUrl(rawUrl: string): boolean {
  const value = rawUrl.trim();
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) {
    return false;
  }

  try {
    const url = new URL(value, window.location.href);
    return url.pathname.includes(LOCAL_ASSET_PATH);
  } catch {
    return value.includes(LOCAL_ASSET_PATH);
  }
}

async function assetUrlToDataUrl(rawUrl: string): Promise<string> {
  if (!isPortableLocalAssetUrl(rawUrl)) {
    return rawUrl;
  }

  const url = new URL(rawUrl, window.location.href).href;
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Could not fetch generated asset (${response.status})`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    return rawUrl;
  }

  return blobToDataUrl(blob);
}

async function inlineSrcset(srcset: string): Promise<string> {
  const entries = srcset
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const inlined = await Promise.all(
    entries.map(async (entry) => {
      const firstSpace = entry.search(/\s/);
      const rawUrl = firstSpace === -1 ? entry : entry.slice(0, firstSpace);
      const descriptor = firstSpace === -1 ? "" : entry.slice(firstSpace).trim();
      const portableUrl = await assetUrlToDataUrl(rawUrl);
      return descriptor ? `${portableUrl} ${descriptor}` : portableUrl;
    })
  );

  return inlined.join(", ");
}

async function inlineCssUrls(cssText: string): Promise<string> {
  const urlPattern = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;
  const matches = Array.from(cssText.matchAll(urlPattern));
  if (!matches.length) {
    return cssText;
  }

  const replacements = new Map<string, string>();
  for (const match of matches) {
    const rawUrl = match[2]?.trim();
    if (!rawUrl || replacements.has(rawUrl) || !isPortableLocalAssetUrl(rawUrl)) {
      continue;
    }

    try {
      replacements.set(rawUrl, await assetUrlToDataUrl(rawUrl));
    } catch (error) {
      console.warn("Could not inline generated CSS asset", rawUrl, error);
    }
  }

  if (!replacements.size) {
    return cssText;
  }

  return cssText.replace(urlPattern, (fullMatch, _quote, rawUrl: string) => {
    const replacement = replacements.get(rawUrl.trim());
    return replacement ? `url("${replacement}")` : fullMatch;
  });
}

function normalizeDocumentSelectors(selectorText: string): string {
  return selectorText
    .replace(/:root\b/g, `#${WORDPRESS_ROOT_ID}`)
    .replace(/\bhtml\b/g, `#${WORDPRESS_ROOT_ID}`)
    .replace(/\bbody\b/g, `#${WORDPRESS_ROOT_ID}`)
    .replace(
      new RegExp(`#${WORDPRESS_ROOT_ID}\\s+#${WORDPRESS_ROOT_ID}`, "g"),
      `#${WORDPRESS_ROOT_ID}`
    );
}

function scopeStyleElement(styleElement: HTMLStyleElement): void {
  const cssText = styleElement.textContent ?? "";
  if (!cssText.trim()) {
    return;
  }

  const scratchDocument = document.implementation.createHTMLDocument("");
  const scratchStyle = scratchDocument.createElement("style");
  scratchStyle.textContent = cssText;
  scratchDocument.head.appendChild(scratchStyle);

  const sheet = scratchStyle.sheet;
  if (!sheet) {
    return;
  }

  const scopeRules = (rules: CSSRuleList, insideKeyframes = false) => {
    Array.from(rules).forEach((rule) => {
      if (rule instanceof CSSKeyframesRule) {
        return;
      }

      if (rule instanceof CSSStyleRule && !insideKeyframes) {
        const normalized = normalizeDocumentSelectors(rule.selectorText);
        if (!normalized.includes(`#${WORDPRESS_ROOT_ID}`)) {
          try {
            rule.selectorText = `#${WORDPRESS_ROOT_ID} :is(${normalized})`;
          } catch {
            // Keep the original selector if the browser cannot rewrite it.
          }
        } else {
          try {
            rule.selectorText = normalized;
          } catch {
            // Keep the original selector if the browser cannot rewrite it.
          }
        }
        return;
      }

      const groupingRule = rule as CSSGroupingRule;
      if ("cssRules" in groupingRule && groupingRule.cssRules) {
        scopeRules(groupingRule.cssRules, insideKeyframes);
      }
    });
  };

  try {
    scopeRules(sheet.cssRules);
    styleElement.textContent = Array.from(sheet.cssRules)
      .map((rule) => rule.cssText)
      .join("\n");
  } catch (error) {
    console.warn("Could not strengthen WordPress CSS isolation", error);
  }
}

async function inlineGeneratedAssets(documentNode: Document): Promise<void> {
  const imageElements = Array.from(documentNode.querySelectorAll<HTMLImageElement>("img[src]"));
  for (const image of imageElements) {
    const src = image.getAttribute("src");
    if (!src || !isPortableLocalAssetUrl(src)) {
      continue;
    }

    try {
      image.setAttribute("src", await assetUrlToDataUrl(src));
    } catch (error) {
      console.warn("Could not inline generated image asset", src, error);
    }
  }

  const srcsetElements = Array.from(
    documentNode.querySelectorAll<HTMLImageElement | HTMLSourceElement>("img[srcset], source[srcset]")
  );
  for (const element of srcsetElements) {
    const srcset = element.getAttribute("srcset");
    if (!srcset || !srcset.includes(LOCAL_ASSET_PATH)) {
      continue;
    }

    try {
      element.setAttribute("srcset", await inlineSrcset(srcset));
    } catch (error) {
      console.warn("Could not inline generated srcset assets", error);
    }
  }

  const styledElements = Array.from(documentNode.querySelectorAll<HTMLElement>("[style]"));
  for (const element of styledElements) {
    const style = element.getAttribute("style");
    if (!style || !style.includes(LOCAL_ASSET_PATH)) {
      continue;
    }
    element.setAttribute("style", await inlineCssUrls(style));
  }

  const styles = Array.from(documentNode.querySelectorAll<HTMLStyleElement>("style"));
  for (const style of styles) {
    style.textContent = await inlineCssUrls(style.textContent ?? "");
  }
}

export async function toWordPressWidgetCode(code: string): Promise<string> {
  const trimmed = code.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(trimmed, "text/html");

    await inlineGeneratedAssets(documentNode);

    const styleElements = Array.from(documentNode.querySelectorAll<HTMLStyleElement>("style"));
    styleElements.forEach(scopeStyleElement);

    const portableHeadNodes = Array.from(documentNode.head.children).filter(
      (element) => {
        const tagName = element.tagName.toLowerCase();

        if (tagName === "style" || tagName === "script") {
          return true;
        }

        if (tagName === "link") {
          const rel = element.getAttribute("rel")?.toLowerCase() ?? "";
          return ["stylesheet", "preconnect", "dns-prefetch"].includes(rel);
        }

        return false;
      }
    );

    const isolationCode = `<style>\n#${WORDPRESS_ROOT_ID}, #${WORDPRESS_ROOT_ID} * { box-sizing: border-box; }\n#${WORDPRESS_ROOT_ID} { width: 100%; max-width: none; margin: 0; padding: 0; }\n</style>`;
    const headCode = portableHeadNodes
      .map((element) => element.outerHTML.trim())
      .filter(Boolean)
      .join("\n");
    const bodyCode = documentNode.body.innerHTML.trim();

    if (!bodyCode) {
      return trimmed;
    }

    const wrappedBody = `<div id="${WORDPRESS_ROOT_ID}">\n${bodyCode}\n</div>`;

    return [isolationCode, headCode, wrappedBody]
      .filter(Boolean)
      .join("\n\n")
      .trim();
  } catch (error) {
    console.warn("Could not convert code to a WordPress widget snippet", error);
    return trimmed;
  }
}
