import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

const HARBOR_ORIGINS = new Set([
  "https://tribeharbor.com",
  "https://www.tribeharbor.com",
]);

function passwordsMatch(candidate: string, actual: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const isFormLogin = contentType
    .toLowerCase()
    .startsWith("application/x-www-form-urlencoded");

  if (isFormLogin) {
    const origin = request.headers.get("origin");
    const isLocalDevelopmentOrigin =
      process.env.NODE_ENV !== "production" &&
      origin !== null &&
      /^http:\/\/localhost:\d+$/.test(origin);
    if ((!origin || !HARBOR_ORIGINS.has(origin)) && !isLocalDevelopmentOrigin) {
      return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
    }
  }

  let password = "";
  try {
    if (isFormLogin) {
      const form = await request.formData();
      const value = form.get("password");
      password = typeof value === "string" ? value : "";
    } else {
      const body = await request.json();
      password = typeof body.password === "string" ? body.password : "";
    }
  } catch {
    // fall through with empty password
  }

  if (!password || !passwordsMatch(password, env.mariePassword)) {
    if (isFormLogin) {
      const origin = request.headers.get("origin")!;
      return NextResponse.redirect(
        new URL("/?leadership=1&login_error=1", origin),
        303,
      );
    }
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }

  const token = await createSessionToken(env.sessionSecret);
  const response = isFormLogin
    ? NextResponse.redirect(new URL("/", env.appBaseUrl ?? request.url), 303)
    : NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
