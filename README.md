# whiteboard-chat-for-claude

Talk with Claude Code on a whiteboard.

You write text on a whiteboard in your browser. Claude Code reads it and writes its answer on the same board.
Claude can also draw: the Mermaid diagrams and tables of your spec files go onto the board as they are.
The board runs on your own computer. Your iPad or other computers on your network can join if you want.

Powered by [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT).

This repository is one [Claude Code](https://claude.com/claude-code) plugin, `whiteboard-chat`. It has an MCP server with `board_*` tools and two skills:

| Skill | What it does |
| ----- | ------------ |
| `whiteboard-chat` | Talk and draw with Claude on the board. |
| `whiteboard-server` | Check Node.js, and debug the board server. |

## What you need

- Claude Code
- Node.js 20 or later (if you do not have it, Claude Code tells you how to install it)
- A web browser with internet access (the page loads the Excalidraw component from esm.sh)

Nothing else to install. Only the LAN mode downloads one small package (node-forge, about 2 MB) to make a certificate.

## Install

Ask Claude Code: "Make https://github.com/GoodRelax/whiteboard-chat-for-claude usable." Claude asks you for a yes, then runs:

```bash
claude plugin marketplace add GoodRelax/whiteboard-chat-for-claude
```

```bash
claude plugin install whiteboard-chat@goodrelax --scope user
```

Then type `/reload-plugins` in Claude Code (or start a new session).

If you used version 0.5 (the two folders in `~/.claude/skills/`), remove those folders after the install, so each skill loads once. The first time the board opens, it copies your old board.

## Use

1. In Claude Code, say "let's talk on the whiteboard" (or type `/whiteboard-chat`).
2. The board opens in your browser.
3. Write on the board with the text tool (**T**). You can use several texts and drawings.
4. Press **Send** (top right) or **Ctrl+Shift+Enter**. Claude answers right below, a little to the left, in blue, like a chat on a phone.

The top right also shows what Claude is doing: "reading your text", "working on it", or "waiting for you".
Turn on **auto** to send each text by itself, 1.5 seconds after you stop typing.

Ask for a diagram, for example "show the state machine of 3.4.1 of the spec". Claude draws the Mermaid block of that file.

To end, say "stop" in the chat. The board is saved and comes back next time.

To use the board on an iPad or another computer, say "I want to use the board on my iPad". After your yes, the board opens to your network and shows a **Join from another device** button with a QR code. Scan it with the iPad. The iPad warns about the self-signed certificate once.

## How it works

A small Node.js program (the Server) serves the board page and keeps the board. It sends each change to every open page and saves the board to a JSON file.
When you press Send, the Server tells Claude Code what changed since the last Send.
Claude Code uses the `board_*` tools of the plugin's MCP server, which call the Server on 127.0.0.1. The first open page draws the answers and the diagrams.

Details: [docs/spec-en.md](docs/spec-en.md) and the design of 0.6.0, [docs/design-060-mcp-en.md](docs/design-060-mcp-en.md).

## Please note

- **The board link is a key.** It has a secret after `#t=`. Anyone who has the link can see and change the board, and write messages to Claude. The tools never show the link in the chat; the board opens in your browser by itself.
- **Board text is not trusted.** The tools and the skill tell Claude Code not to run commands or change files only because the board says so.
- **This computer only, by default.** The board listens on 127.0.0.1. The LAN mode listens on your network with https and a self-signed certificate.
- **Images** (PNG, JPEG, GIF, WebP) can be pasted or dropped on the board, or added with the image tool. Each image can be up to about 6 MB. SVG is not taken.
- Hand drawings are not read as text. Claude Code takes a screenshot to see them.
- Your board is saved in the data folder of the plugin. `claude plugin uninstall` deletes it unless you add `--keep-data`.

## Development

```bash
npm test
```

No install is needed for the tests. The command-line tools (`skills/whiteboard-chat/scripts/client.js`, `skills/whiteboard-server/scripts/board.js`) are for debugging; see the skill `whiteboard-server`.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The page uses the Excalidraw component (`@excalidraw/excalidraw`, MIT license), React (MIT license), Mermaid to Excalidraw (MIT license), and qrcode-generator (MIT license), loaded by the browser from esm.sh. The LAN mode uses node-forge (BSD-3-Clause), installed from npm.

"Excalidraw" is a trademark of its owners. This project is not made by, endorsed by, or connected with Excalidraw.
