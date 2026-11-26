export const OFFLINE = "Can't reach the server. Check your connection; retrying…";

export async function api<T = any>(path: string, body?: object, token = ''): Promise<T> {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-token': token },
    body: body && JSON.stringify(body),
  }).catch(() => { throw new Error(OFFLINE); });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Server error (${res.status}). Try again in a moment.`);
  return json;
}

/** What creating or joining a room returns; kept so a reload rejoins. */
export type Session = { room: string; token: string };
