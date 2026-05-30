# Hermes v2.2 Changes

- Scan Inbox now scans the full inbox by using a 1970 sentinel date instead of a 3-day lookback. Microsoft Graph inbox fetching follows `@odata.nextLink` pagination newest-first and caps each scan at 500 messages.
- Re-process now backfills tasks for stored non-`other` emails that have no existing task or contract by source email/conversation, reusing the watcher task-creation helper. The API/UI now report the `backfilled` count and the guard keeps repeated runs idempotent.
