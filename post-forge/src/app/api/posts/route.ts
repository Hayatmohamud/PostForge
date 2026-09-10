import { postsResponseSchema } from "../../../lib/contracts/api";
import { AppError, toPublicError } from "../../../lib/errors";
import { listPosts } from "../../../lib/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function failure(error: unknown): Response {
  const publicError = toPublicError(error);
  return Response.json({ error: publicError }, { status: publicError.status, headers });
}

function optionsFrom(request: Request): { limit?: number; cursor?: string } {
  const url = new URL(request.url);
  const limitValues = url.searchParams.getAll("limit");
  const cursorValues = url.searchParams.getAll("cursor");
  if (limitValues.length > 1 || cursorValues.length > 1) throw new AppError("INVALID_INPUT");

  const rawLimit = limitValues[0];
  let limit: number | undefined;
  if (rawLimit !== undefined) {
    if (!/^\d+$/.test(rawLimit)) throw new AppError("INVALID_INPUT");
    limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit)) throw new AppError("INVALID_INPUT");
  }
  return { ...(limit === undefined ? {} : { limit }), ...(cursorValues[0] === undefined ? {} : { cursor: cursorValues[0] }) };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const result = await listPosts(optionsFrom(request));
    return Response.json(postsResponseSchema.parse(result), { status: 200, headers });
  } catch (error) {
    return failure(error);
  }
}
