import assert from "node:assert/strict";
import test from "node:test";
import {
  sabActionReconciliationDecision,
  summarizeMirrorEvidence,
  type WorkspaceMirrorEvidence,
} from "./workspace";

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

test("summarizes completed and missing mirror requirements without inventing a reusable link", () => {
  const evidence: WorkspaceMirrorEvidence[] = [
    {
      requirementKey: "agent-resident-license",
      requirement: "Agent resident license",
      nextRequiredAction: "",
      status: "Complete",
      uploadUrl: "https://example.com/upload",
      sourceUpdatedAt: "2026-07-20",
      lastSyncedAt: "2026-07-25",
    },
    {
      requirementKey: "agent-eo-certificate",
      requirement: "Agent E&O insurance certificate",
      nextRequiredAction: "",
      status: "Complete",
      uploadUrl: "https://example.com/upload",
      sourceUpdatedAt: "2026-07-20",
      lastSyncedAt: "2026-07-25",
    },
    {
      requirementKey: "agent-direct-deposit",
      requirement: "Agent direct deposit form",
      nextRequiredAction: "",
      status: "Missing",
      uploadUrl: "",
      sourceUpdatedAt: "2026-07-20",
      lastSyncedAt: "2026-07-25",
    },
    {
      requirementKey: "agent-w9",
      requirement: "Agent W-9",
      nextRequiredAction: "",
      status: "Missing",
      uploadUrl: "",
      sourceUpdatedAt: "2026-07-20",
      lastSyncedAt: "2026-07-25",
    },
  ];

  assert.equal(
    summarizeMirrorEvidence(evidence),
    "SAB currently confirms Agent resident license and Agent E&O insurance certificate as complete. SAB still reports Agent direct deposit form and Agent W-9 as requiring attention. No reusable upload link is available for Agent direct deposit form and Agent W-9 because SAB sends those as agent-specific signature emails.",
  );
});
