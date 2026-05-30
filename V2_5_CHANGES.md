# Hermes v2.5 Changes

- Added a server-side Microsoft Graph sendMail helper that reuses the existing client-credentials token flow and surfaces Graph send errors with status/response details.
- Added a per-person open-task digest HTML builder and `POST /api/admin/send-digest` admin/test route for sending task digests without changing database schema or People behavior.
