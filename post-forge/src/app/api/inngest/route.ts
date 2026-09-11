import { serve } from "inngest/next";
import { createInngestClient } from "../../../inngest/client";
import { createGeneratePostFunction } from "../../../inngest/generate-post";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ServedHandlers = ReturnType<typeof serve>;
let handlers: ServedHandlers | undefined;

function getHandlers(): ServedHandlers {
  if (!handlers) {
    const client = createInngestClient();
    const generatePost = createGeneratePostFunction(client);

    // Keep one registration boundary for the workflow. Its onFailure hook is
    // attached by createGeneratePostFunction; the SDK creates its companion.
    handlers = serve({
      client,
      functions: [generatePost],
    });
  }
  return handlers;
}

export const GET = (...args: Parameters<ServedHandlers["GET"]>): ReturnType<ServedHandlers["GET"]> => getHandlers().GET(...args);
export const POST = (...args: Parameters<ServedHandlers["POST"]>): ReturnType<ServedHandlers["POST"]> => getHandlers().POST(...args);
export const PUT = (...args: Parameters<ServedHandlers["PUT"]>): ReturnType<ServedHandlers["PUT"]> => getHandlers().PUT(...args);
