export default function urlToPathSafeStr(url: string) {
  const parsed = new URL(url);
  if (parsed.pathname == '/') {
    return parsed.hostname;
  }
  return parsed.hostname + parsed.pathname.replace('/', '_').replace(/[^a-zA-Z0-9]+/g, "-")
}