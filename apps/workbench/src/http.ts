export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export interface ApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    missing?: string[];
    invalid?: { field: string; message: string }[];
    feature?: string;
  };
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  extra?: {
    missing?: string[];
    invalid?: { field: string; message: string }[];
    feature?: string;
  },
): Response {
  const body: ApiErrorBody = {
    ok: false,
    error: {
      code,
      message,
      ...extra,
    },
  };
  return json(status, body);
}
