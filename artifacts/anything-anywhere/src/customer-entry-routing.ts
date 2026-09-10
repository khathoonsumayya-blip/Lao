const PRESENTATION_QUERY_KEYS = [
  'fullScreen',
  'nativeBrowserPresentationStyle',
] as const;

export function locationWithPresentationQuery(path: string, search: string): string {
  const source = new URLSearchParams(search);
  const destination = new URLSearchParams();

  for (const key of PRESENTATION_QUERY_KEYS) {
    const value = source.get(key);
    if (value !== null) destination.set(key, value);
  }

  const query = destination.toString();
  return query ? `${path}?${query}` : path;
}

export function customerSignInLocation(search: string): string {
  return locationWithPresentationQuery('/sign-in', search);
}