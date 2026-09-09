import { errorResponseSchema, postResponseSchema } from "../../../../lib/contracts/api";
import { AppError, toPublicError } from "../../../../lib/errors";
import { getPublicPost } from "../../../../lib/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function failure(error: unknown, postId?: string): Response {
  let publicError = toPublicError(error, { postId });
  // A validated lookup has no user-correctable provider/evidence failures.
  if (postId && publicError.status < 500) publicError = toPublicError(new AppError("TERMINAL_FAILURE"), { postId });
  return Response.json(errorResponseSchema.parse({ error: publicError }), { status: publicError.status, headers });
}

/** Every poll reads the repository afresh; no handler, browser, or shared-cache reuse. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let id: string;
  try { ({ id } = await context.params); }
  catch { return failure(new AppError("TERMINAL_FAILURE")); }

  // Repository IDs are Mongo ObjectIds, even though other shared contracts allow UUIDs.
  if (typeof id !== "string" || id.length !== 24 || !/^[a-f0-9]{24}$/i.test(id)) return failure(new AppError("INVALID_INPUT"));
  const postId = id.toLowerCase();
  try {
    const post = await getPublicPost(postId);
    if (!post) {
      // Keep the shared error envelope; HTTP 404 distinguishes an absent reference from malformed input.
      return Response.json(errorResponseSchema.parse({ error: {
        code: "INVALID_INPUT", message: "Post not found.", status: 404, retryable: false, postId,
      } }), { status: 404, headers });
    }
    return Response.json(postResponseSchema.parse({ post }), { status: 200, headers });
  } catch (error) {
    return failure(error, postId);
  }
}
