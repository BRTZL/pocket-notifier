import { fetch } from "expo/fetch";

const HTTP_TIMEOUT_MS = 15_000;

/** Why an `http` action did not complete. */
export class HttpActionError extends Error {}

type HttpActionRequest = {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: string | undefined;
};

/**
 * Sends a message's `http` action from the phone. The URL comes from the publisher, so
 * the request is locked down: HTTPS only (checked again here, not only by the API), no
 * cookies or other credentials, no redirects (a redirect could point anywhere), and a
 * timeout. Resolves with the response status when the server answered 2xx.
 */
export async function runHttpAction({ url, method, body }: HttpActionRequest): Promise<number> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpActionError("The action's URL is not valid.");
  }
  if (parsed.protocol !== "https:") {
    throw new HttpActionError("Only HTTPS actions can be sent.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.href, {
      method,
      body: method === "GET" ? undefined : body,
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new HttpActionError(`The server answered ${response.status}.`);
    }
    return response.status;
  } catch (error) {
    if (error instanceof HttpActionError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new HttpActionError("The request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
