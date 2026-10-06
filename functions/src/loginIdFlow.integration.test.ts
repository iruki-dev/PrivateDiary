import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Id accounts' password reset, end to end on the emulators
 * (functions/src/index.ts's setRecoveryEmail / requestLoginPasswordReset):
 *
 *  - an id account is an ordinary email/password user under the reserved
 *    domain, which the Auth emulator accepts;
 *  - only that account can set its reset email, and only with a fresh
 *    sign-in;
 *  - a reset request mails a Firebase reset link to that address — once
 *    per throttle window, and never for an unknown id or one without an
 *    address, answering the same in every case.
 *
 * Run via `pnpm test:integration` (live auth/firestore/functions emulators).
 */

const PROJECT_ID = "demo-privatediary";
const REGION = "us-central1";
const AUTH_EMULATOR = "127.0.0.1:9099";
const FUNCTIONS_EMULATOR_ORIGIN = "http://127.0.0.1:5001";

process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR;
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = PROJECT_ID;

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore } = await import("firebase-admin/firestore");

if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

const LOGIN_ID = `flow_${Date.now().toString(36)}`;
const EMAIL = `${LOGIN_ID}@id.privatediary.invalid`;
const PASSWORD = "login password 1";

async function signUpWithPassword(email: string, password: string): Promise<{ idToken: string; localId: string }> {
  const response = await fetch(
    `http://${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const body = (await response.json()) as { idToken?: string; localId?: string; error?: unknown };
  if (!body.idToken || !body.localId) throw new Error(`signUp failed: ${JSON.stringify(body.error)}`);
  return { idToken: body.idToken, localId: body.localId };
}

async function call(
  name: string,
  data: unknown,
  idToken?: string
): Promise<{ status: number; result?: unknown; error?: { status?: string; message?: string } }> {
  const response = await fetch(`${FUNCTIONS_EMULATOR_ORIGIN}/${PROJECT_ID}/${REGION}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { status?: string; message?: string } };
  return { status: response.status, ...body };
}

async function mailTo(address: string) {
  const snapshot = await db.collection("mail").where("to", "==", address).get();
  return snapshot.docs.map((doc) => doc.data() as { to: string; message: { subject: string; text: string } });
}

let idToken = "";
let uid = "";

beforeAll(async () => {
  ({ idToken, localId: uid } = await signUpWithPassword(EMAIL, PASSWORD));
});

afterAll(async () => {
  await auth.deleteUser(uid).catch(() => undefined);
});

describe("setRecoveryEmail", () => {
  it("refuses a malformed address and the reserved domain", async () => {
    expect((await call("setRecoveryEmail", { email: "nope" }, idToken)).error?.status).toBe("INVALID_ARGUMENT");
    expect((await call("setRecoveryEmail", { email: "x@id.privatediary.invalid" }, idToken)).error?.status).toBe(
      "INVALID_ARGUMENT"
    );
  });

  it("refuses an email (non-id) account", async () => {
    const other = await signUpWithPassword(`someone_${Date.now()}@example.com`, PASSWORD);
    const result = await call("setRecoveryEmail", { email: "a@example.com" }, other.idToken);
    expect(result.error?.status).toBe("FAILED_PRECONDITION");
    await auth.deleteUser(other.localId);
  });

  it("stores the address for a freshly signed-in id account, readable only server-side-written", async () => {
    const result = await call("setRecoveryEmail", { email: "owner@example.com" }, idToken);
    expect(result.result).toEqual({ email: "owner@example.com" });
    expect((await db.collection("accountRecovery").doc(uid).get()).data()?.email).toBe("owner@example.com");
  });
});

describe("requestLoginPasswordReset", () => {
  it("mails a reset link to the reset email, once per throttle window", async () => {
    expect((await call("requestLoginPasswordReset", { loginId: LOGIN_ID.toUpperCase() })).result).toEqual({ ok: true });
    const first = await mailTo("owner@example.com");
    expect(first).toHaveLength(1);
    expect(first[0].message.text).toContain(LOGIN_ID);
    expect(first[0].message.text).toMatch(/https?:\/\//);

    expect((await call("requestLoginPasswordReset", { loginId: LOGIN_ID })).result).toEqual({ ok: true });
    expect(await mailTo("owner@example.com")).toHaveLength(1);
  });

  it("answers the same for an unknown id, and mails nothing", async () => {
    const before = (await db.collection("mail").get()).size;
    expect((await call("requestLoginPasswordReset", { loginId: "nobody_here_1" })).result).toEqual({ ok: true });
    expect((await db.collection("mail").get()).size).toBe(before);
  });

  it("refuses something that can't be an id", async () => {
    expect((await call("requestLoginPasswordReset", { loginId: "a b" })).error?.status).toBe("INVALID_ARGUMENT");
  });

  it("stops sending once the reset email is removed", async () => {
    expect((await call("setRecoveryEmail", { email: null }, idToken)).result).toEqual({ email: null });
    await db.collection("resetMailThrottle").doc(uid).delete();
    await call("requestLoginPasswordReset", { loginId: LOGIN_ID });
    expect(await mailTo("owner@example.com")).toHaveLength(1);
  });
});
