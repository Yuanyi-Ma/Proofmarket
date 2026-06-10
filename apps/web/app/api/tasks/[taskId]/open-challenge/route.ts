import { getTaskService } from "../../../../../lib/api";
import { jsonOrError } from "../../../../../lib/routeError";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { taskId } = await context.params;

  return jsonOrError(() => getTaskService().openChallenge(taskId));
}
