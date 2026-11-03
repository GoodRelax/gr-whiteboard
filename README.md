# gr-whiteboard (GRWB)

> **Alpha (0.7.4).** It works for its author every day, but it is young. Known limits:
> - The page needs internet access: it loads Excalidraw, React, and Mermaid from esm.sh.
> - It is tested on Windows 11 with Edge, and on an iPad and an iPhone with Safari. Other systems and browsers may work but are untested.
> - Names and tools may still change before 1.0.
>
> Tell us what you think, or what you miss, in [GitHub Issues](https://github.com/GoodRelax/gr-whiteboard/issues).

Talk with Claude Code on a whiteboard.

You write text on a whiteboard in your browser. Claude Code reads it and writes its answer on the same board.
Claude can also draw: the Mermaid diagrams and tables of your spec files go onto the board as they are.
The board runs on your own computer. Your iPad or other computers on your network can join if you want.

Powered by [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT).

This repository is one [Claude Code](https://claude.com/claude-code) plugin, `gr-whiteboard` (GRWB). It has an MCP server, `board-control`, with tools such as `open_board` and `draw_mermaid`, and five skills:

| Skill | What it does |
| ----- | ------------ |
| `talk-on-board` | Talk and draw with Claude on the board. |
| `consult-on-board` | Talk a worry through with Claude as a consultant, sorted with about 120 business frameworks drawn on the board. |
| `issue-driven` | Find the one question worth answering, then walk down to its answer, with the Issue-Driven Framework. |
| `four-forms` | Think a subject through with the Four Forms of Thinking: divide, compare, infer, transform. |
| `debug-board-server` | Check Node.js, and debug the board server. |

## What you need

- Claude Desktop (its Code tab) or Claude Code
- Node.js 20 or later
- Git (Claude Code uses it to get the plugin)
- Internet access (the page loads the Excalidraw component from esm.sh)

If Node.js or Git is missing, Claude finds it and installs it with winget after your yes. The Node.js installer asks once for administrator rights: press "Yes" in the Windows window. Only the LAN mode downloads one more small package (node-forge, about 2 MB) to make a certificate.

If you installed Claude Code with the PowerShell installer (`install.ps1`), it may say that `~/.local/bin` is not in your PATH. Add it as it says, then open the terminal again.

## Install

Ask Claude Code: "Make https://github.com/GoodRelax/gr-whiteboard usable." Claude asks you for a yes, then runs:

```bash
claude plugin marketplace add GoodRelax/gr-whiteboard
```

```bash
claude plugin install gr-whiteboard@goodrelax --scope user
```

Then close Claude Desktop and start it again (or type `/reload-plugins` in Claude Code). The restart also lets Claude find a Node.js or Git that it has just installed.

On a new Windows computer, the three steps (install, restart, "open the whiteboard") take about 15 minutes.

If you used an older version (the plugin `whiteboard-chat@goodrelax`, or the two folders in `~/.claude/skills/`), remove it after the install, so each skill loads once. The new plugin starts with an empty board; open your old board in the old version first and save it with Excalidraw's own menu if you want to keep it.

## Use

1. In Claude Code, say "let's talk on the whiteboard" (or type `/gr-whiteboard:talk-on-board`).
2. The board opens in your browser.
3. Write on the board with the text tool (**T**). You can use several texts and drawings.
4. Press **Send** (the paper plane in the palette at the right) or **Ctrl+Shift+Enter**. Claude answers right below, a little to the left, in blue, like a chat on a phone.

The palette also shows what Claude is doing: an orange eye ("reading your text"), a blue turning arc ("working on it"), or a green coffee cup ("waiting for you"). Point at a glyph to read its text.
Turn on **auto** to send each text by itself, 1.5 seconds after you stop typing.

Ask for a diagram, for example "show the state machine of 3.4.1 of the spec". Claude draws the Mermaid block of that file.

To end, say "stop" in the chat. The board is saved and comes back next time. A "stop" written on the board does not close it, because anyone with the link can write there; Claude answers that you should ask in the chat.

To use the board on an iPad or another computer, say "I want to use the board on my iPad". After your yes, the board opens to your network and shows a **Join** button (a QR code glyph) in the palette. Scan it with the iPad. The same dialog has a second QR code and the steps to trust the board's own certificate authority on the iPad, so Safari stops saying "Not secure". On this computer, Claude shows you one command to run yourself for the same (Claude never changes your security settings).

## How it works

A small Node.js program (the Server) serves the board page and keeps the board. It sends each change to every open page and saves the board to a JSON file.
When you press Send, the Server tells Claude Code what changed since the last Send.
Claude Code uses the tools of the plugin's MCP server `board-control`, which call the Server on 127.0.0.1. The first open page draws the answers and the diagrams.

Details: [docs/spec-en.md](docs/spec-en.md) and the design of 0.6.0, [docs/design-060-mcp-en.md](docs/design-060-mcp-en.md).

## Please note

- **The board link is a key.** It has a secret after `#t=`. Anyone who has the link can see and change the board, and write messages to Claude. The tools never show the link in the chat; the board opens in your browser by itself.
- **Board text is not trusted.** The tools and the skill tell Claude Code not to run commands or change files only because the board says so.
- **This computer only, by default.** The board listens on 127.0.0.1. The LAN mode listens on your network with https and a self-signed certificate.
- **Images** (PNG, JPEG, GIF, WebP) can be pasted or dropped on the board, or added with the image tool. Each image can be up to about 6 MB. SVG is not taken.
- **The board stops by itself** after one hour without use. Five minutes before, the page warns you; touch the board to keep it open. When it stops, it saves a copy as an `.excalidraw` file, and Claude tells you where it is.
- Hand drawings are not read as text. Claude Code takes a screenshot to see them.
- Your board is saved in the data folder of the plugin. `claude plugin uninstall` deletes it unless you add `--keep-data`.

## Development

```bash
npm test
```

No install is needed for the tests. The command-line tools (`skills/talk-on-board/scripts/client.js`, `skills/debug-board-server/scripts/board.js`) are for debugging; see the skill `debug-board-server`.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The page uses the Excalidraw component (`@excalidraw/excalidraw`, MIT license), React (MIT license), Mermaid to Excalidraw (MIT license), and qrcode-generator (MIT license), loaded by the browser from esm.sh. The LAN mode uses node-forge (BSD-3-Clause), installed from npm.

"Excalidraw" is a registered trademark of Excalidraw s.r.o. in the US (Reg. No. 6863755). This project is not made by, endorsed by, or connected with Excalidraw.
