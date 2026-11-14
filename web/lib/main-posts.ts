/** Pure SocialDB main-post parsing. No runtime imports, so `node --test` loads it directly. */

/** Builds the SocialDB key for an account's main post. */
export function mainPostKey(accountId: string): string {
  return `${accountId}/post/main`;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Parses a `post/main` value into its text, or null when it is not a post. */
export function parseMainPost(raw: unknown): { text: string } | null {
  const main = typeof raw === "string" ? safeJsonParse(raw) : raw;
  if (!main || typeof main !== "object" || !("text" in main)) return null;
  return typeof main.text === "string" ? { text: main.text } : null;
}

/** Extracts every author's main-post text from ONE merged SocialDB `get()` response. */
export function collectMainPosts(data: unknown, authors: readonly string[]): Map<string, string> {
  const posts = new Map<string, string>();
  if (!data || typeof data !== "object") return posts;
  // RPC boundary: near-social-js `get()` returns a keyed object of untyped account data.
  const record = data as Record<string, unknown>;
  for (const author of authors) {
    const accountData: unknown = record[author];
    if (!accountData || typeof accountData !== "object" || !("post" in accountData)) continue;
    const post: unknown = accountData.post;
    if (!post || typeof post !== "object" || !("main" in post)) continue;
    const main = parseMainPost(post.main);
    if (main) posts.set(author, main.text);
  }
  return posts;
}
