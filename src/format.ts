import type { JsonContent, LooseRecord } from "./types.js";

export function asJsonContent(value: unknown): JsonContent {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    details: null,
  };
}

export function asTextContent(text: string): JsonContent {
  return {
    content: [{ type: "text", text }],
    details: null,
  };
}

export function parseJsonInput<T>(raw: string | undefined, fieldName: string): T | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${fieldName} JSON: ${message}`);
  }
}

export function wrapPageResponse(response: LooseRecord & { url?: string | null }) {
  return {
    url: response.url ?? null,
    response,
  };
}
