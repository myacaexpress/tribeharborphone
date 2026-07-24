import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/session";

/**
 * Everything requires a session except:
 * - /login and /api/login (how you get a session)
 * - /api/voice/* and /api/webhooks/* (Twilio webhooks; they carry their own
 *   signature validation inside the route handlers)
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/manifest.webmanifest",
  "/sw.js",
  "/offline.html",
  "/api/login",
  "/api/health",
  "/api/voice",
  "/api/webhooks",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.SESSION_SECRET;
  const authed = secret ? await verifySessionToken(secret, token) : false;
  if (authed) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Skip Next internals and static assets.
  matcher: ["/((?!_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
