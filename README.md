# whiteboard-chat-for-claude

Talk with Claude Code on a whiteboard.

You write text on a whiteboard in your browser. Claude Code reads it and writes its answer on the same board.
The board runs on your own computer. Other people on your network can join if you want.

Powered by [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT).

This repository has two [Claude Code](https://claude.com/claude-code) Skills:

| Skill | Command | What it does |
| ----- | ------- | ------------ |
| `whiteboard-chat` | `/whiteboard-chat` | Talk with Claude on the board. Starts the board if it is not running. |
| `whiteboard-server` | `/whiteboard-server` | Start, stop, or check the board. Open it to your network (LAN). |

## What you need

- Claude Code
- Node.js 20 or later (if you do not have it, Claude Code tells you how to install it)
- A web browser with internet access (the page loads the Excalidraw component from esm.sh)

Nothing else to install. Only the LAN mode downloads one small package (node-forge, about 2 MB) to make a certificate.

## Install

Copy the two folders in `skills/` into your Claude Code skills folder. Keep them side by side:

| OS | Folder |
| -- | ------ |
| Windows | `%USERPROFILE%\.claude\skills\` |
| macOS / Linux | `~/.claude/skills/` |

After that you have `.claude/skills/whiteboard-chat/` and `.claude/skills/whiteboard-server/`.

Without git: on the GitHub page, click **Code > Download ZIP**, unzip it, and copy the two folders from `skills/`.

Or simply ask Claude Code: "Install the two skills in the skills folder of https://github.com/GoodRelax/whiteboard-chat-for-claude".

## Use

1. In Claude Code, type `/whiteboard-chat`.
2. Claude Code starts the board and shows a link. Open it in your browser.
3. Write on the board with the text tool (**T**). You can use several texts and drawings.
4. Press **Send** (top right) or **Ctrl+Shift+Enter**. Claude answers right below, a little to the left, in blue, like a chat on a phone.

The top right also shows what Claude is doing: "reading your text", "working on it", or "waiting for you".
Turn on **auto** to send each text by itself, 1.5 seconds after you stop typing.

To end, say "stop" in the chat. The board is saved and comes back next time.

To let other computers on your network join, say "open the whiteboard to the LAN". The browser on the other computers will warn about the self-signed certificate once.

## How it works

A small Node.js program (the Server) serves the board page and keeps the board. It sends each change to every open page and saves the board to a JSON file.
The Server also reads the board. When you press Send, it tells Claude Code everything you wrote since the last Send.
Claude Code sends its answer to the Server, and the first open page puts the answer on the board.

Details: [docs/spec-en.md](docs/spec-en.md).

## Please note

- **The board link is a key.** It has a secret after `#t=`. Anyone who has the link can see and change the board, and write messages to Claude. Do not share it outside the people you trust.
- **Board text is not trusted.** The skill tells Claude Code not to run commands or change files only because the board says so.
- **This computer only, by default.** The board listens on 127.0.0.1. The LAN mode listens on your network with https and a self-signed certificate.
- **Images** (PNG, JPEG, GIF, WebP) can be pasted or dropped on the board, or added with the image tool. Each image can be up to about 6 MB. SVG is not taken.
- Hand drawings are not read as text. Claude Code takes a screenshot to see them.
- Your board is saved in `whiteboard-server/.data/board.json` in your skills folder.

## Development

```bash
npm test
```

No install is needed for the tests.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The page uses the Excalidraw component (`@excalidraw/excalidraw`, MIT license) and React (MIT license), loaded by the browser from esm.sh. The LAN mode uses node-forge (BSD-3-Clause), installed from npm.

"Excalidraw" is a trademark of its owners. This project is not made by, endorsed by, or connected with Excalidraw.
