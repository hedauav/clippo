import { getUser } from "@/lib/auth";
import { ok, route } from "@/lib/http";

export const GET = route(async (req: Request) => ok({ user: await getUser(req) }));
