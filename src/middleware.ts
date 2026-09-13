import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  misprefixedVars,
  supabaseConfigured,
  supabaseUrlProblem,
} from "@/lib/supabase/env";

// /api/health must be reachable without a session: it exists to
// diagnose deployments that cannot authenticate anyone yet.
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/auth",
  "/api/cron",
  "/api/health",
];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function middleware(request: NextRequest) {
  // A deployment with no Supabase credentials would otherwise throw here
  // and return 500 for EVERY request — including the public pages and
  // the error page itself. Fail with something a human can act on, and
  // let the request through so the app can render its own message.
  if (!supabaseConfigured()) {
    const misprefixed = misprefixedVars();
    console.error(
      misprefixed.length > 0
        ? `[nurora] ${misprefixed.join("; ")} — in THIS BUILD.\n\n` +
          "Either it is named without the NEXT_PUBLIC_ prefix (which is " +
          "what makes the value available to the browser, where the " +
          "realtime features run), OR it was added after this build ran.\n\n" +
          "NEXT_PUBLIC_ values are compiled into the bundle, never read at " +
          "runtime — so if you have already added them, this deployment " +
          "predates them. Redeploy with the build cache DISABLED " +
          "(Vercel: Deployments -> ... -> Redeploy, untick 'Use existing " +
          "Build Cache'). See DEPLOY.md."
        : "[nurora] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY " +
          "are not set. Set them in your deployment's environment variables " +
          "and redeploy — see DEPLOY.md.",
    );
    return NextResponse.next({ request });
  }

  // A present-but-unusable URL passes the check above and then throws
  // inside @supabase/ssr, which 500s every route. Report it and let the
  // request through so the app can render its own message.
  const urlProblem = supabaseUrlProblem();
  if (urlProblem) {
    console.error(`[nurora] ${urlProblem}`);
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() revalidates the token with Supabase and refreshes the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
