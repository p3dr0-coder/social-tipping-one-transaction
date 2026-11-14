import test from "node:test";
import assert from "node:assert/strict";
import { mainPostKey, parseMainPost, collectMainPosts } from "../lib/main-posts.ts";

// Oracle: the OLD per-author `loadMainPost` behavior (one get() per author), replicated
// here. The batched `collectMainPosts` must produce byte-identical post text per author.
function oldLoadMainPost(data, author) {
  const accountData = data?.[author];
  if (!accountData || typeof accountData !== "object" || !("post" in accountData)) return null;
  const post = accountData.post;
  if (!post || typeof post !== "object" || !("main" in post)) return null;
  return parseMainPost(post.main);
}
function oldBehavior(data, authors) {
  const posts = new Map();
  for (const author of authors) {
    const main = oldLoadMainPost(data, author);
    if (main) posts.set(author, main.text);
  }
  return posts;
}

test("batched collectMainPosts is oracle-equal to N per-author reads (mixed shapes)", () => {
  const authors = ["a.near", "b.near", "c.near", "d.near", "e.near", "f.near", "g.near", "h.near"];
  const data = {
    "a.near": { post: { main: JSON.stringify({ text: "hello" }) } },
    "b.near": { post: { main: { text: "raw object" } } },
    "c.near": { post: { main: "not json" } },
    "d.near": {},
    "e.near": { post: {} },
    "f.near": { post: { main: JSON.stringify({ nope: 1 }) } },
    // g.near, h.near missing entirely.
  };
  const expected = oldBehavior(data, authors);
  const actual = collectMainPosts(data, authors);
  assert.deepEqual([...actual], [...expected]);
  assert.deepEqual([...actual], [["a.near", "hello"], ["b.near", "raw object"]]);
});

test("mainPostKey builds the SocialDB key; parseMainPost covers the edge cases", () => {
  assert.equal(mainPostKey("alice.near"), "alice.near/post/main");
  assert.equal(parseMainPost('{"text":"x"}').text, "x");
  assert.equal(parseMainPost({ text: "y" }).text, "y");
  assert.equal(parseMainPost("bad json"), null);
  assert.equal(parseMainPost(42), null);
  assert.equal(parseMainPost({ nope: 1 }), null);
});

test("missing, null, or empty data yields an empty map without throwing", () => {
  assert.equal(collectMainPosts(null, ["a.near"]).size, 0);
  assert.equal(collectMainPosts(undefined, ["a.near"]).size, 0);
  assert.equal(collectMainPosts({}, ["a.near"]).size, 0);
  assert.equal(collectMainPosts("not an object", ["a.near"]).size, 0);
});

test("one merged get() response covers all authors with no N+1 reads", () => {
  const authors = ["x.near", "y.near", "z.near"];
  const data = {
    "x.near": { post: { main: JSON.stringify({ text: "one" }) } },
    "y.near": { post: { main: JSON.stringify({ text: "two" }) } },
    "z.near": { post: { main: JSON.stringify({ text: "three" }) } },
  };
  const posts = collectMainPosts(data, authors);
  assert.equal(posts.size, 3);
  assert.equal(posts.get("y.near"), "two");
  assert.deepEqual([...posts.keys()], authors);
});
