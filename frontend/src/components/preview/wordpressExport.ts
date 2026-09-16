export function toWordPressWidgetCode(code: string): string {
  const trimmed = code.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(trimmed, "text/html");

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

    const headCode = portableHeadNodes
      .map((element) => element.outerHTML.trim())
      .filter(Boolean)
      .join("\n");
    const bodyCode = documentNode.body.innerHTML.trim();

    if (!bodyCode) {
      return trimmed;
    }

    return [headCode, bodyCode].filter(Boolean).join("\n\n").trim();
  } catch (error) {
    console.warn("Could not convert code to a WordPress widget snippet", error);
    return trimmed;
  }
}
