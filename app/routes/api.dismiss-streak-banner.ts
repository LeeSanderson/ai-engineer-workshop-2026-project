import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.dismiss-streak-banner";
import { getCurrentUserId } from "~/lib/session";
import { dismissStreakBanner } from "~/services/pointsService";
import { parseFormData } from "~/lib/validation";

const schema = z.object({
  lastActiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function action({ request }: Route.ActionArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) return data({ ok: false }, { status: 401 });

  const formData = await request.formData();
  const parsed = parseFormData(formData, schema);
  if (!parsed.success) return data({ ok: false }, { status: 400 });

  dismissStreakBanner(userId, parsed.data.lastActiveDate);
  return { ok: true };
}
