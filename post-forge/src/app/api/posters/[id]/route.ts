import { AppError, toPublicError } from "../../../../lib/errors";
import { getPosterStream } from "../../../../lib/poster-storage";
import { Readable } from "node:stream";

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
    const poster = await getPosterStream(id);
    if (!poster) {
      return Response.json({ error: "Poster not found" }, {
        status: 404,
        headers: safeHeaders,
      });
    }

    return new Response(Readable.toWeb(poster.stream) as unknown as ReadableStream<Uint8Array>, {
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
