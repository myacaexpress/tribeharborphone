import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSabMirrorInputs,
  type SabRequirementConfig,
  type SabScopeEntry,
} from "./sab-highlevel";

const scope: SabScopeEntry[] = [
  {
    sourceType: "contact",
    sourceRecordId: "contact-perla",
    displayName: "Perla Villalobos",
    recordType: "Direct agent",
    parentAgency: "Trifecta Benefits",
    scopeStatus: "TriBe direct",
  },
  {
    sourceType: "agency",
    sourceRecordId: "agency-three-pillars",
    displayName: "Three Pillars Health Group",
    recordType: "Downline agency",
    parentAgency: "Trifecta Benefits",
    scopeStatus: "TriBe downline",
  },
];

const requirements: SabRequirementConfig[] = [
  {
    sourceType: "contact",
    fieldKey: "field-license",
    requirementKey: "resident-license",
    requirement: "Resident license",
    nextRequiredAction: "Upload the resident license.",
    actionOwner: "Mark",
    uploadUrl: "https://example.com/upload",
  },
  {
    sourceType: "agency",
    fieldKey: "agency_status",
    requirementKey: "agency-status",
    requirement: "Agency status",
    nextRequiredAction: "Ask SAB to review the agency status.",
    actionOwner: "SAB",
    valueMode: "status",
  },
];

test("builds mirror rows only for immutable allowlisted records", () => {
  const records = new Map([
    [
      "contact:contact-perla",
      {
        updatedAt: "2026-07-24T10:00:00Z",
        valueFor: (key: string) => (key === "field-license" ? "" : undefined),
      },
    ],
    [
      "agency:agency-three-pillars",
      {
        updatedAt: "2026-07-24T11:00:00Z",
        valueFor: (key: string) => (key === "agency_status" ? "Approved" : undefined),
      },
    ],
    [
      "contact:someone-else",
      {
        updatedAt: "2026-07-24T12:00:00Z",
        valueFor: () => "secret",
      },
    ],
  ]);

  const rows = buildSabMirrorInputs({
    config: {
      locationId: "location",
      agencySchemaKey: "custom_objects.agencies",
      scope,
      requirements,
    },
    records,
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => [row.sourceRecordId, row.requirementStatus]),
    [
      ["contact-perla", "Missing"],
      ["agency-three-pillars", "Complete"],
    ],
  );
  assert.ok(rows.every((row) => !row.sourceRecordId.includes("someone-else")));
});

test("uses human review for an unknown status instead of guessing", () => {
  const rows = buildSabMirrorInputs({
    config: {
      locationId: "location",
      agencySchemaKey: "custom_objects.agencies",
      scope: scope.slice(1),
      requirements: requirements.slice(1),
    },
    records: new Map([
      [
        "agency:agency-three-pillars",
        { updatedAt: "", valueFor: () => "Escalated to carrier" },
      ],
    ]),
  });
  assert.equal(rows[0]?.requirementStatus, "Human Review");
});
