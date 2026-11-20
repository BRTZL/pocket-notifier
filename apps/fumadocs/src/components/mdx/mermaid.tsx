"use client";

import { useEffect, useId, useState } from "react";

type MermaidModule = typeof import("mermaid");

let mermaidPromise: Promise<MermaidModule> | undefined;

function loadMermaid() {
  mermaidPromise ??= import("mermaid");
  return mermaidPromise;
}

function isDarkMode() {
  return document.documentElement.classList.contains("dark");
}

function useDarkMode() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(isDarkMode());
    const observer = new MutationObserver(() => setDark(isDarkMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replaceAll(":", "");
  const dark = useDarkMode();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      const { default: mermaid } = await loadMermaid();
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        fontFamily: "inherit",
        theme: dark ? "dark" : "default",
      });
      const result = await mermaid.render(`mermaid-${id}`, chart.replaceAll("\\n", "\n"));
      if (!cancelled) {
        setSvg(result.svg);
        setError(null);
      }
    }

    render().catch((reason: unknown) => {
      if (!cancelled) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [chart, dark, id]);

  if (error) {
    return <pre className="text-fd-error text-sm">{error}</pre>;
  }

  if (!svg) {
    return <div className="bg-fd-muted my-4 h-24 animate-pulse rounded-lg" />;
  }

  return (
    <div
      className="my-4 flex justify-center overflow-x-auto [&_svg]:max-w-full"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid renders with securityLevel "strict" from first-party docs content.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
