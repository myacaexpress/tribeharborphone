# Mobile composer design QA

Reference: the attached iPhone screenshot showing a long draft clipped to one
line in the message composer.

Primary outcome: let a user read and edit the full outgoing message on mobile
without hiding the conversation or moving the AI Draft and Send controls.

## Simplicity review

- Primary action: review the draft, then send it.
- Supporting choices: AI Draft remains adjacent to Send.
- Critical state: the full draft remains visible while composing.
- Removed or deferred: no new expand button or modal; the existing composer
  grows automatically and scrolls only for unusually long drafts.

## Verification

- Lint: passed.
- Production build: passed.
- Mobile-width visual check: the composer grows to the full draft height
  without creating a nested scrollbar; the conversation history yields space
  and remains the single scrollable surface.

Final result: passed.
