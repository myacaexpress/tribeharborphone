import assert from "node:assert/strict";
import test from "node:test";
import { includeApprovedUploadLink } from "./support-ai";

const UPLOAD_URL =
  "https://sites.leadconnectorhq.com/preview/example?notrack=true";

test("adds the approved upload link before the open offer of help", () => {
  assert.equal(
    includeApprovedUploadLink(
      "Hi Sierra, this is Anika with TriBe Support. It looks like a few Step 2 documents may still need attention. Is there anything else I can help you with?",
      UPLOAD_URL,
      true,
    ),
    `Hi Sierra, this is Anika with TriBe Support. It looks like a few Step 2 documents may still need attention. If helpful, here is the upload link: ${UPLOAD_URL} Is there anything else I can help you with?`,
  );
});

test("does not duplicate a link the model already included", () => {
  const message = `If helpful, here is the upload link: ${UPLOAD_URL}`;
  assert.equal(includeApprovedUploadLink(message, UPLOAD_URL, true), message);
});

test("does not add an upload link when it is unrelated to the conversation", () => {
  const message = "I can check with the team and follow up here.";
  assert.equal(
    includeApprovedUploadLink(message, UPLOAD_URL, false),
    message,
  );
});
