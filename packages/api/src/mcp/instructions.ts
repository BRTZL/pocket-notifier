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
3. send_notification: title is the outcome in at most 32 characters ("Login flow done", "Need a decision: DB"); body is one line: result first, the user's next step last.
4. Priority: 2 low (FYI), 3 normal (done), 4 high (blocked, needs a decision), 5 urgent (production or data at risk). Default 3.
5. Blocked on a decision: pass ask with the question and up to 3 quickReplies. You cannot read the reply through this server; tell the user in your session that you asked.
6. When a workstream is finished, update_feature_status to "done".

Never put secrets, tokens, passwords or private keys in a notification. Name the file or env var instead.`;
