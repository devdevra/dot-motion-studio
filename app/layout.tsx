import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dot Motion Studio",
  description: "PNG sprites and simple 2D motion, made with clear controls.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
