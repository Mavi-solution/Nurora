import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Nurora",
  description: "Nurora",
};

/**
 * Deliberately bare.
 *
 * The app injects its own reset stylesheet and rewrites the viewport tag
 * itself, the instant its module loads — see fitViewport() at the top of
 * nurora-app.jsx. Anything declared here would be a second opinion on
 * the same two things, so there is nothing here but the document.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
