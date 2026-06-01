# Hermes v2.9 changes

- Added expanded reply rendering in task detail: each linked thread message now includes sender, sent timestamp, new reply text, and a default-collapsed quoted-history block.
- Added Inbox ordering by computed `lastActivityAt` from linked thread message timestamps, falling back to `createdAt`; task cards continue to display the original created date.
