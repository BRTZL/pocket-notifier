import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";

import "./global.css";
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
});

// Absolute URLs for the Open Graph images of the deployed site.
export const metadata: Metadata = {
  metadataBase: new URL("https://notifier.bartuozel.com"),
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider search={{ options: { type: "static", api: "/search.json" } }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
