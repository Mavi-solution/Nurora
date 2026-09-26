import type { NextConfig } from "next";

/*
 * Nothing to configure.
 *
 * The app is one client component holding its own data in the browser —
 * no remote images, no server routes, no database. The previous config's
 * image hosts existed for Supabase avatars, which no longer exist.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
