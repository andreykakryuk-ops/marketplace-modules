import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "wb_session";
const PUBLIC_PATHS = new Set(["/login", "/setup", "/api/health"]);

export function proxy(request: NextRequest) {
  if (process.env.AUTH_REQUIRED === "0") return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
