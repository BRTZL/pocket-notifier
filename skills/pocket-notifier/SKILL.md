---
name: pocket-notifier
description: Notify the user's phone through the Pocket Notifier MCP server when a task is done, when you are blocked on their decision, on a failure you cannot fix, or when a long task finished. Use whenever the pocket-notifier MCP tools (send_notification, list_projects, list_features) are available, or the user asks to be notified, pinged or told on their phone.
---

# Pocket Notifier

Pocket Notifier sends push notifications to the user's phone. Use it so the user can step away and come back only when you need them.

## Connect (once per machine)

The server is a remote MCP server with OAuth sign-in at `https://notifier.bartuozel.com/api/mcp`. For a self-hosted deployment, use `https://<your domain>/api/mcp` instead.

```bash
# Claude Code
claude mcp add --transport http pocket-notifier https://notifier.bartuozel.com/api/mcp
# then in a session: /mcp -> pocket-notifier -> Authenticate

# Codex
codex mcp add pocket-notifier --url https://notifier.bartuozel.com/api/mcp
codex mcp login pocket-notifier
```

A browser window opens. The user signs in with their Pocket Notifier email and password and allows access. Accounts are invite-only; there is no sign-up on that page.

## When to notify

Send at most one notification per turn, as the last thing you do, and only for:

| Situation | Priority | Example title |
| --- | --- | --- |
| Task the user asked for is done and verified | 3 | `Login flow done` |
| Blocked on the user's decision (use `ask`) | 4 | `Need a decision: DB` |
| Failure you cannot fix yourself | 4 | `Build broken: auth` |
| Production or data at risk | 5 | `Prod deploy failing` |
| Long task (5+ minutes) finished | 3 | `Migration finished` |
| FYI the user asked for | 2 | `Docs published` |

Never notify for progress updates, steps, things starting, plain Q&A, or turns that took under about two minutes.

## Project and feature

- **Project** = the product or repository, lowercase, for example `rezme` (usually the repo folder name).
- **Feature** = your current workstream in a few words, for example `Improving performance`. In the app each feature is a chat thread, so keep using the same feature for the same workstream.

Before the first notification in a session:

1. `list_projects`. If the project is missing, `create_project` with `name` (and `displayName`). If the name is taken by someone else, pick another (for example `rezme-app`).
2. `list_features` for the project. Reuse a matching feature; otherwise `create_feature`, or just pass the new name to `send_notification`, which creates a missing feature.
3. Leave `project` out only for notifications that belong to no project; they go to the user's private General project.

When a workstream is finished, call `update_feature_status` with `done`.

Project owners can change a project's `displayName`, `description` or `iconUrl` (an HTTPS image) with `update_project`; `create_project` takes `iconUrl` too.

## Writing the notification

- `title`: the outcome, at most 32 characters. No project prefix (the app shows it).
- `body`: one line. Result first, the user's next step last. Example: `Magic-link login works, tests pass. Review PR #12.`
- `url`: where to look (PR, CI run, deploy, your agent thread). It shows as an Open button on the message in the thread and as an action on the notification. Tapping the notification itself opens the thread: the feature's, or the project-level thread when you leave `feature` out.
- `actions`: up to 2 extra link buttons `{ label, url }`.
- `attachmentId`: one file per notification (screenshot, log, video, PDF, at most 95 MB). Call `create_upload` with the same `project`, `fileName`, `contentType` and the exact `size` in bytes, run the `curl` command it returns with the file's path (the link works once, for 1 hour), then pass its `attachmentId`. Images show as the notification's picture.
- `ask` when blocked: `{ question, quickReplies: up to 3 short answers, allowText }`. You cannot read the answer through this server yet, so also say in your session what you asked and wait for the user there.

```json
{
  "project": "rezme",
  "feature": "Improving performance",
  "title": "Need a decision: cache",
  "body": "Redis or in-memory LRU for the search cache?",
  "priority": 4,
  "ask": { "question": "Which cache?", "quickReplies": ["Redis", "LRU"] }
}
```

## Never

- Never put secrets in a notification: no tokens, passwords, API keys, private keys, cookies or connection strings. Name the env var or file that holds them instead.
- Never send personal data the user did not ask to receive on their phone.
- Never send more than one notification per turn, or repeat the same one.

## Errors

Tool errors say what to do next, for example `Project 'x' not found. Call list_projects to see your projects, or create_project to add it.` Follow them once. If sending fails again, tell the user in your reply instead of retrying in a loop.

## Without MCP

Scripts and agents without MCP can use the REST API: `POST <server>/v1/projects/<project>/messages` with `Authorization: Bearer <access token>` (for example the `agent-notify` script). See the docs page "Coding agents".
