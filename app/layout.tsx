import type { Metadata } from "next";
import "@pdfslick/react/dist/pdf_viewer.css";
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
      <body>
        {children}
        <div id="portal" />
      </body>
    </html>
  );
}
