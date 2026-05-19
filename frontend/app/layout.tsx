import "./globals.css";
import type { ReactNode } from "react";

// Next App Router auto-detects `app/icon.png` (or favicon.ico) as the
// favicon — no `icons` config needed here. This just makes the tab/bookmark
// text read cleanly next to that favicon.
export const metadata = {
  title: "SignalDesk — local market research desk",
  description:
    "Private, local-first AI market research, signals & trading journal.",
};

// The root layout wraps every page. `dark` class is set up-front so the dark
// theme is the default state, not a toggle we apply later.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
