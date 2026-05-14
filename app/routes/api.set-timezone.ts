import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.set-timezone";
import { getCurrentUserId } from "~/lib/session";
import { captureBrowserTimezone } from "~/services/userService";
import { parseFormData } from "~/lib/validation";

const schema = z.object({
  timezone: z.string().min(1).max(64),
});

export async function action({ request }: Route.ActionArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) return data({ ok: false }, { status: 401 });

  const formData = await request.formData();
  const parsed = parseFormData(formData, schema);
  if (!parsed.success) return data({ ok: false }, { status: 400 });

  captureBrowserTimezone(userId, parsed.data.timezone);
  return { ok: true };
}
