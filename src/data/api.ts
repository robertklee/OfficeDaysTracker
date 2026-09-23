import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options: { body?: unknown; accountId?: string } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.accountId ? { 'X-RTO-Account': options.accountId } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(
      'Cannot reach the account service.' +
        (path === '/planner' && options.body !== undefined
          ? ' The save may have reached the server. Retry the same edit or export it before leaving this page.'
          : ' Check your connection and try again.'),
      0,
    );
  }
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new ApiError(
      'The account service returned an unexpected response. Check that the account service is running.',
      response.status,
    );
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      'The account service returned unreadable JSON. Try again later.',
      response.status,
    );
  }
  if (!response.ok) {
    const failure = z.object({ error: z.string() }).safeParse(result);
    throw new ApiError(
      failure.success ? failure.data.error : 'The account request failed.',
      response.status,
    );
  }
  const parsed = schema.safeParse(result);
  if (!parsed.success)
    throw new ApiError(
      'The account service returned an invalid response. No saved status can be confirmed.',
      response.status,
    );
  return parsed.data;
}
