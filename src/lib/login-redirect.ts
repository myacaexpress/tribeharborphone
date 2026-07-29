export function getFormLoginSuccessUrl(
  requestUrl: string,
  publicAppUrl: string | null,
  appBaseUrl: string | null,
): URL {
  return new URL("/", publicAppUrl ?? appBaseUrl ?? requestUrl);
}
