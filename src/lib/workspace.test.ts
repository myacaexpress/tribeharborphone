import assert from "node:assert/strict";
import test from "node:test";
import { sabActionReconciliationDecision } from "./workspace";

test("completes the existing action when SAB resolves the requirement", () => {
  assert.deepEqual(
    sabActionReconciliationDecision({
      previousActionStatus: "Open",
      previousSourceStatus: "Missing",
      sourceStatus: "Accepted",
    }),
    {
      nextActionStatus: "Complete",
      syncLifecycle: "Resolved automatically",
    },
  );
});

test("reopens the same action for review when SAB reopens a resolved item", () => {
  assert.deepEqual(
    sabActionReconciliationDecision({
      previousActionStatus: "Complete",
      previousSourceStatus: "Verified",
      sourceStatus: "Missing",
    }),
    {
      nextActionStatus: "Review Required",
      syncLifecycle: "Source reopened; review required",
    },
  );
});

test("does not duplicate or reopen a manually closed pending action", () => {
  assert.deepEqual(
    sabActionReconciliationDecision({
      previousActionStatus: "Complete",
      previousSourceStatus: "Missing",
      sourceStatus: "Under Review",
    }),
    {
      nextActionStatus: "Complete",
      syncLifecycle: "Pending at source; action remains manually closed",
    },
  );
});
