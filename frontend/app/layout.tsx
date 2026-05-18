import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "SignalDesk Local",
  description: "Private local-first AI market research dashboard",
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
