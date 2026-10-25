// Route gate (Next 16's `proxy` — the renamed middleware convention; the
// `middleware` filename and export are deprecated in 16).
//
// The session lives in an httpOnly cookie the API sets on localhost:4000. The
// browser sends that cookie to localhost:3000 too (same-site, different port),
// so this server-side gate can simply check for its presence — no JWT
// verification here, no secret on the web side. Presence is a routing hint,
// not a security boundary: every real authorization decision happens in the
// API, and a stale/expired cookie lands the user on /login via the 401 path
// in the app shell anyway.
//
// The gate can only ever see `crm_access`: the refresh cookie is scoped to
// Path=/api/v1/auth (ADR-007), so browsers withhold it from page requests.
// That is deliberate — it also means a session whose access cookie has expired
// lands on /login again after a full reload. api.ts renews silently for the
// session that is already open, which is the case that used to fail mid-use.
import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'crm_access';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const isLogin = pathname === '/login';

  if (!hasSession && !isLogin) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (hasSession && isLogin) {
    // Already signed in: skip the login form and land on the reviewer home.
    return NextResponse.redirect(new URL('/', request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Gate app routes only; skip assets, the API itself and anything static.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)'],
};
