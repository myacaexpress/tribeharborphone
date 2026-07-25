import assert from "node:assert/strict";
import test from "node:test";
import {
  actionOwnerLabel,
  shouldAutoAcknowledge,
  shouldWelcomeToTribe,
  supportAcknowledgement,
} from "./support-policy";

test("uses the exact friendly wording for the first support interaction", () => {
  assert.equal(
    supportAcknowledgement("Mark", true),
    "Anika here, and welcome to TriBe. I’ll check with Mark on that and follow up here.",
  );
});

test("uses the exact friendly wording for later support interactions", () => {
  assert.equal(
    supportAcknowledgement("Mark", false),
    "Anika here. I’ll check with Mark on that and follow up here.",
  );
});

test("preserves supported owner labels", () => {
  assert.equal(actionOwnerLabel(" Mark "), "Mark");
  assert.equal(actionOwnerLabel("Michael"), "Michael");
  assert.equal(actionOwnerLabel("Shawn"), "Shawn");
  assert.equal(actionOwnerLabel("SAB"), "the SAB team");
});

test("welcomes when there is no prior support reply and at most two messages", () => {
  assert.equal(shouldWelcomeToTribe([]), true);
  assert.equal(
    shouldWelcomeToTribe([
      { speaker: "supported_agent", text: "First" },
      { speaker: "group_member", text: "Second" },
      { speaker: "group_member", text: "   " },
    ]),
    true,
  );
});

test("does not welcome after any prior support reply", () => {
  assert.equal(
    shouldWelcomeToTribe([
      { speaker: "tribe_support", text: "" },
      { speaker: "supported_agent", text: "Can you help?" },
    ]),
    false,
  );
});

test("does not welcome in an established conversation", () => {
  assert.equal(
    shouldWelcomeToTribe([
      { speaker: "supported_agent", text: "First" },
      { speaker: "group_member", text: "Second" },
      { speaker: "supported_agent", text: "Third" },
    ]),
    false,
  );
});

test("acknowledges only a new action-related help topic", () => {
  const classification = {
    intent: "help_request" as const,
    confidence: 0.96,
    directlyAboutAction: true,
    isNewHelpTopic: true,
  };

  assert.equal(shouldAutoAcknowledge(classification), true);
  assert.equal(
    shouldAutoAcknowledge({
      ...classification,
      isNewHelpTopic: false,
    }),
    false,
  );
});
