/**
 * The MCP server's `instructions`: a compact version of `skills/pocket-notifier/SKILL.md`
 * at the repo root. Keep the two in step.
 */
export const MCP_INSTRUCTIONS = `Pocket Notifier sends notifications to the user's phone.

Vocabulary: a project is a product or repo (e.g. "rezme"); a feature is the current workstream inside it (e.g. "Improving performance"). In the app each feature is a chat thread.

When to notify: a task the user asked for is done and verified; you are blocked on the user's decision; a failure you cannot fix yourself; a long task (5+ minutes) finished. Never for progress updates, trivial steps or plain Q&A. At most one notification per turn.

How:
1. Project = the repo or product name, lowercase (e.g. "rezme"). Call list_projects once; if it is missing, call create_project. Omit project to use the user's private General project.
2. Feature = the current workstream in a few words. Call list_features; reuse a matching one, or create_feature. send_notification also creates a missing feature from the name you give.
3. send_notification: title is the outcome in at most 32 characters ("Login flow done", "Need a decision: DB"); body is one line: result first, the user's next step last. Tapping the notification opens its thread (the feature's, or the project-level thread when feature is omitted); url (PR, CI run, deploy) shows as an Open button there and as a notification action.
4. Priority: 2 low (FYI), 3 normal (done), 4 high (blocked, needs a decision), 5 urgent (production or data at risk). Default 3.
5. Blocked on a decision: pass ask with the question; it is added to the body. The notification has no reply buttons, so ask the user in your session too and wait for the answer there.
6. When a workstream is finished, update_feature_status to "done".
7. To attach a file (screenshot, log, video, PDF): create_upload with the same project, run the curl command it returns with the file's path, then send_notification with its attachmentId. One file per notification.
8. update_project changes a project's display name, description or iconUrl (owners only).
9. Running in T3 Code ($T3CODE_THREAD_ID is set): pass t3 { environmentId: contents of ~/.t3/userdata/environment-id, threadId: $T3CODE_THREAD_ID } on every send_notification. All messages from one thread land in one feature, and each gets an Open in T3 button where the user replies.

Never put secrets, tokens, passwords or private keys in a notification. Name the file or env var instead.`;
