import assert from "node:assert/strict";
import test from "node:test";
import { getFormLoginSuccessUrl } from "./login-redirect";

test("uses the canonical public phone domain behind Cloud Run", () => {
  const url = getFormLoginSuccessUrl(
    "https://localhost:8080/api/login",
    "https://phone.tribeharbor.com",
    "https://tribeharborphone-618590726026.us-central1.run.app",
  );

  assert.equal(url.href, "https://phone.tribeharbor.com/");
});

test("falls back to the webhook base URL when no public domain is configured", () => {
  const url = getFormLoginSuccessUrl(
    "https://localhost:8080/api/login",
    null,
    "https://tribeharborphone-618590726026.us-central1.run.app",
  );

  assert.equal(
    url.href,
    "https://tribeharborphone-618590726026.us-central1.run.app/",
  );
});
