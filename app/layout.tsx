import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "COMPARER",
  description: "Document review and comparison workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
