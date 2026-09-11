import {
  errorResponseSchema,
  generateRequestSchema,
  generateResponseSchema,
} from "../../../lib/contracts/api";
import { AppError, toPublicError } from "../../../lib/errors";
import {
  GenerationDispatchError,
  submitGeneration,
} from "../../../lib/generation-dispatch";
import { SubmissionConflictError } from "../../../lib/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function failure(error: unknown): Response {
  const publicError = error instanceof GenerationDispatchError
    ? error.publicError
    : toPublicError(error);
  const responseError = error instanceof SubmissionConflictError
    ? { ...publicError, status: 409 }
    : publicError;
  return Response.json(errorResponseSchema.parse({ error: responseError }), {
    status: responseError.status,
    headers,
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure(new AppError("INVALID_INPUT"));
  }

  const parsed = generateRequestSchema.safeParse(body);
  if (!parsed.success) return failure(new AppError("INVALID_INPUT"));

  try {
    const result = await submitGeneration(parsed.data);
    return Response.json(generateResponseSchema.parse({ postId: result.postId }), {
      status: 202,
      headers,
    });
  } catch (error) {
    return failure(error);
  }
}
