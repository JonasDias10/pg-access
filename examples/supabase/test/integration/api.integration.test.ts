import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { supabaseUrl } from "../../src/supabase.js";

/**
 * Exercises the Fastify API (src/app.ts) end to end against a real local
 * Supabase project: real sign-ups, real logins, real Postgres RLS deciding
 * what each user's requests can see or write. Requires `supabase start`
 * (see the README) and a filled-in .env.
 */
describe("supabase example API", () => {
  const app = buildApp();
  const runId = randomUUID().slice(0, 8);
  const password = "password123";

  beforeAll(async () => {
    try {
      await fetch(`${supabaseUrl}/auth/v1/health`);
    } catch (error) {
      throw new Error(
        `Could not reach Supabase at ${supabaseUrl}. Run 'supabase start' (see README), copy its output into .env, then rerun.`,
        { cause: error },
      );
    }
    await app.ready();
  });

  afterAll(() => app.close());

  async function signUp(name: string) {
    const response = await app.inject({
      method: "POST",
      url: "/signup",
      payload: { email: `${name}-${runId}@example.com`, password },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { userId: string; accessToken: string };
  }

  it("signs up and then logs in with the same credentials", async () => {
    const email = `login-${runId}@example.com`;

    const signupResponse = await app.inject({
      method: "POST",
      url: "/signup",
      payload: { email, password },
    });
    expect(signupResponse.statusCode).toBe(201);

    const loginResponse = await app.inject({
      method: "POST",
      url: "/login",
      payload: { email, password },
    });
    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.json()).toMatchObject({ accessToken: expect.any(String) });
  });

  it("rejects login with the wrong password", async () => {
    const email = `wrongpass-${runId}@example.com`;
    await app.inject({ method: "POST", url: "/signup", payload: { email, password } });

    const response = await app.inject({
      method: "POST",
      url: "/login",
      payload: { email, password: "not-the-password" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("requires a Bearer token to reach /posts", async () => {
    const response = await app.inject({ method: "GET", url: "/posts" });
    expect(response.statusCode).toBe(401);
  });

  it("scopes reads and writes to the caller, enforced by RLS through the API", async () => {
    const alice = await signUp("alice");
    const bob = await signUp("bob");

    const createAlice = await app.inject({
      method: "POST",
      url: "/posts",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { title: "Alice's post" },
    });
    expect(createAlice.statusCode).toBe(201);
    const alicePost = createAlice.json() as { id: string };

    const createBob = await app.inject({
      method: "POST",
      url: "/posts",
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { title: "Bob's post" },
    });
    expect(createBob.statusCode).toBe(201);

    const aliceList = await app.inject({
      method: "GET",
      url: "/posts",
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    const aliceTitles = (aliceList.json() as Array<{ title: string }>).map((post) => post.title);
    expect(aliceTitles).toEqual(["Alice's post"]);

    // Bob's token is genuinely valid, but the profiles_update/posts_update
    // policy scopes UPDATE to `owner("user_id")`, so RLS filters Alice's
    // row out before the update runs: 0 rows match, not a 403.
    const bobUpdatesAlicesPost = await app.inject({
      method: "PATCH",
      url: `/posts/${alicePost.id}`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { title: "pwned" },
    });
    expect(bobUpdatesAlicesPost.statusCode).toBe(404);

    const bobDeletesAlicesPost = await app.inject({
      method: "DELETE",
      url: `/posts/${alicePost.id}`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    expect(bobDeletesAlicesPost.statusCode).toBe(404);

    const aliceDeletesOwnPost = await app.inject({
      method: "DELETE",
      url: `/posts/${alicePost.id}`,
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect(aliceDeletesOwnPost.statusCode).toBe(204);
  });
});
