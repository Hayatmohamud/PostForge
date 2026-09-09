import { AppError, toPublicError } from "../../../../lib/errors";
import { getPoster } from "../../../../lib/poster-storage";

const objectIdPattern = /^[a-f0-9]{24}$/i;

const safeHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

function errorResponse(error: unknown): Response {
  const publicError = toPublicError(error);
  return Response.json(publicError, {
    status: publicError.status,
    headers: safeHeaders,
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let id: string;
  try {
    ({ id } = await context.params);
  } catch (error) {
    return errorResponse(error);
  }

  if (!objectIdPattern.test(id)) return errorResponse(new AppError("INVALID_INPUT"));

  try {
    const poster = await getPoster(id);
    if (!poster) {
      return Response.json({ error: "Poster not found" }, {
        status: 404,
        headers: safeHeaders,
      });
    }

    // Response's DOM typings accept an ArrayBuffer while MongoDB's Buffer is
    // an ArrayBufferView. Slice to the exact validated payload range first.
    const body = poster.bytes.buffer.slice(
      poster.bytes.byteOffset,
      poster.bytes.byteOffset + poster.bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: {
        ...safeHeaders,
        "Content-Type": poster.mediaType,
        "Content-Length": String(poster.byteSize),
        "Content-Disposition": `inline; filename="${poster.id}.${poster.mediaType.slice("image/".length)}"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
