import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth";
import { route } from "@/lib/http";

export const POST = route(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});
