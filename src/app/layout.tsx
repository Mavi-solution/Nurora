import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK"],
});

export const metadata: Metadata = {
  title: "Nurora",
  description: "Nurora",
};

/**
 * Deliberately bare apart from the fonts.
 *
 * The app injects its own reset stylesheet and rewrites the viewport tag
 * itself, the instant its module loads — see fitViewport() at the top of
 * nurora-app.jsx. Anything else declared here would be a second opinion
 * on the same two things.
 *
 * next/font is safe to add because it only emits @font-face rules and the
 * two variables below. Importing globals.css would additionally bring
 * Tailwind's preflight, which lands on top of that reset and changes how
 * every screen renders — the sign-in page restates its design tokens as
 * literals rather than reach for it.
 *
 * The variables MUST live on <html>: a var() reference that resolves
 * nowhere makes the whole declaration invalid at computed-value time,
 * which silently drops the sign-in page to system fonts.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
