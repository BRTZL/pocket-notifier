/**
 * Server-rendered sign-in and consent pages for MCP clients signing in with OAuth.
 * Plain HTML forms, no client script.
 */
import { OAUTH_CONSENT_PATH, OAUTH_LOGIN_PATH } from "@notifier/auth/paths";
import { raw } from "hono/html";
import type { Child } from "hono/jsx";

const STYLES = `
:root { color-scheme: light; --accent: #E94826; --accent-dark: #c93a1b; --text: #1b1b1f; --muted: #6b6b76; --line: #ececf0; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #ffffff; color: var(--text); font-family: Figtree, system-ui, -apple-system, "Segoe UI", sans-serif; padding: 24px 16px; }
main { width: 100%; max-width: 380px; }
.brand { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; font-weight: 700; font-size: 17px; }
.mark { width: 34px; height: 34px; border-radius: 10px; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 18px; }
h1 { font-size: 24px; line-height: 1.25; margin: 0 0 8px; font-weight: 700; }
p { margin: 0 0 20px; color: var(--muted); line-height: 1.5; font-size: 15px; }
label { display: block; font-size: 14px; font-weight: 600; }
label input { margin-top: 6px; font-weight: 400; }
input[type=email], input[type=password] { width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; font: inherit; font-size: 16px; margin-bottom: 16px; background: #fafafb; }
input:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: transparent; background: #fff; }
button { width: 100%; padding: 13px 16px; border: 0; border-radius: 12px; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; }
.primary { background: var(--accent); color: #fff; }
.primary:hover { background: var(--accent-dark); }
.secondary { background: #f3f3f5; color: var(--text); margin-top: 10px; }
.error { background: #fdecea; color: #9b2c17; border-radius: 12px; padding: 12px 14px; font-size: 14px; margin-bottom: 16px; }
.card { border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin-bottom: 20px; }
.card strong { display: block; font-size: 16px; margin-bottom: 4px; }
.card span { color: var(--muted); font-size: 14px; word-break: break-all; }
ul { list-style: none; padding: 0; margin: 0 0 20px; }
li { padding: 10px 0 10px 28px; position: relative; border-bottom: 1px solid var(--line); font-size: 15px; }
li:last-child { border-bottom: 0; }
li::before { content: ""; position: absolute; left: 4px; top: 15px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
.foot { margin-top: 18px; font-size: 13px; color: var(--muted); text-align: center; }
`;

function Layout(props: { title: string; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <meta content="noindex" name="robots" />
        <title>{props.title} · Pocket Notifier</title>
        <link href="https://fonts.googleapis.com" rel="preconnect" />
        <link crossorigin="anonymous" href="https://fonts.gstatic.com" rel="preconnect" />
        <link
          href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* raw: JSX would HTML-escape the quotes in the CSS and break rules like font-family. */}
        <style>{raw(STYLES)}</style>
      </head>
      <body>
        <main>
          <div class="brand">
            <div aria-hidden="true" class="mark">
              P
            </div>
            Pocket Notifier
          </div>
          {props.children}
        </main>
      </body>
    </html>
  );
}

export type LoginPageProps = {
  /** The signed authorization query, passed back on submit. */
  oauthQuery: string;
  clientName: string | null;
  email?: string;
  error?: string;
};

export function LoginPage(props: LoginPageProps) {
  return (
    <Layout title="Sign in">
      <h1>Sign in to continue</h1>
      <p>
        {props.clientName ? <strong>{props.clientName}</strong> : "An app"} wants to send
        notifications to your phone with your Pocket Notifier account.
      </p>
      {props.error ? (
        <div class="error" role="alert">
          {props.error}
        </div>
      ) : null}
      <form action={OAUTH_LOGIN_PATH} method="post">
        <input name="oauth_query" type="hidden" value={props.oauthQuery} />
        <label>
          Email
          <input
            autocomplete="email"
            autofocus
            name="email"
            required
            type="email"
            value={props.email ?? ""}
          />
        </label>
        <label>
          Password
          <input autocomplete="current-password" name="password" required type="password" />
        </label>
        <button class="primary" type="submit">
          Sign in
        </button>
      </form>
      <div class="foot">
        No account? Pocket Notifier is invite-only: ask the owner for an invite.
      </div>
    </Layout>
  );
}

const SCOPE_TEXT: Record<string, string> = {
  "notifier:read": "See your projects and features",
  "notifier:write": "Send notifications to your phone and manage features",
  offline_access: "Stay connected for up to 30 days",
  openid: "Know who you are",
  profile: "See your name",
  email: "See your email address",
};

function describeScope(scope: string): string {
  return SCOPE_TEXT[scope] ?? scope;
}

export type ConsentPageProps = {
  oauthQuery: string;
  clientName: string;
  /** Where the app receives the result, e.g. `127.0.0.1:33418`. */
  redirectHost: string;
  scopes: string[];
  userEmail: string;
};

export function ConsentPage(props: ConsentPageProps) {
  return (
    <Layout title="Allow access">
      <h1>Allow {props.clientName}?</h1>
      <p>Signed in as {props.userEmail}.</p>
      <div class="card">
        <strong>{props.clientName}</strong>
        <span>Returns to {props.redirectHost}</span>
      </div>
      <ul>
        {props.scopes.map((scope) => (
          <li key={scope}>{describeScope(scope)}</li>
        ))}
      </ul>
      <form action={OAUTH_CONSENT_PATH} method="post">
        <input name="oauth_query" type="hidden" value={props.oauthQuery} />
        <button class="primary" name="accept" type="submit" value="yes">
          Allow
        </button>
        <button class="secondary" name="accept" type="submit" value="no">
          Deny
        </button>
      </form>
      <div class="foot">Only allow apps you started yourself, such as your coding agent.</div>
    </Layout>
  );
}

export function MessagePage(props: { title: string; message: string }) {
  return (
    <Layout title={props.title}>
      <h1>{props.title}</h1>
      <p>{props.message}</p>
    </Layout>
  );
}
