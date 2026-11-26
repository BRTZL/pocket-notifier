# T3 bridge

Follows the threads of a local [T3 Code](https://t3.codes) server and reports their status to Pocket Notifier. The phone then shows which threads are running, waiting on you, finished or failed, and pushes only what you would otherwise miss:

- **Failed:** a thread's run failed (not after you pressed Stop).
- **Finished, unannounced:** a run of 5 minutes or more finished, the agent sent no notification during it, and you had not opened the thread in T3 in the last few minutes.

Waiting for an approval or an answer never pushes from here; T3's own mobile app does that, and you answer there. Every message links back to the thread with **Open in T3**.

## How it works

- It reads T3's live thread stream (`orchestration.subscribeShell` over `ws://<T3 origin>/ws`) with a read-only token it issues itself with the `t3` CLI (`t3 auth session issue --scope orchestration:read`, 30 days, renewed a day before it expires).
- For each top-level thread (no subagents or side chats) it works out the phase the way T3's own notifications do, and posts it to `POST /v1/t3/threads` when the phase, title, branch or pull request changes.
- A T3 project maps to the Pocket Notifier project named after its workspace folder (`~/code/my-app` is `my-app`), created on first use. A thread maps to one feature, the same one agents in that thread send to.
- For a finished run it reads the agent's last reply from the thread transcript as the summary. The server masks secrets and markdown before storing or sending it.
- It sends a heartbeat every minute (`POST /v1/t3/heartbeat`), and resumes the stream where it stopped after a restart or a lost connection.
- On its first run it records threads quiet for over a day without reporting them.

No dependencies: Node 24+ runs the TypeScript sources directly.

## Set up (macOS)

1. In the app, create an access token with scope "all" (Settings → Tokens).
2. Save it, readable only by you:

   ```sh
   mkdir -p ~/.config/pocket-notifier
   printf 'NOTIFIER_TOKEN=%s\n' '<token>' > ~/.config/pocket-notifier/t3-bridge.env
   chmod 600 ~/.config/pocket-notifier/t3-bridge.env
   ```

3. Install the background service, which starts at login and restarts when it stops:

   ```sh
   apps/t3-bridge/scripts/install-launchd.sh
   tail -f ~/Library/Logs/pocket-notifier-t3-bridge.log
   ```

To remove it: `apps/t3-bridge/scripts/install-launchd.sh uninstall`.

## Config

| Variable | Default | |
| --- | --- | --- |
| `NOTIFIER_TOKEN` | (required) | Pocket Notifier access token |
| `NOTIFIER_API_URL` | `https://notifier.bartuozel.com/api` | Your server's API |
| `T3_CLI` | `~/.t3/bin/t3` | The T3 CLI, to issue the read-only token |
| `T3CODE_HOME` | `~/.t3` | T3's home folder |
| `T3_BRIDGE_ENV` | `~/.config/pocket-notifier/t3-bridge.env` | Config file |
| `T3_BRIDGE_STATE_DIR` | `~/.local/state/pocket-notifier/t3-bridge` | Stream position, reported state, T3 token |

The bridge is quiet while the Mac sleeps or T3 is closed; it catches up when they are back.
