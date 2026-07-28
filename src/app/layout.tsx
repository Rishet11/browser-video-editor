import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MagicRoll Editor",
  description: "A browser-based video editor with timeline editing and AI assist tools.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full overflow-hidden flex flex-col">{children}</body>
    </html>
  );
}
