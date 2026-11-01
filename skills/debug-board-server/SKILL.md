---
name: debug-board-server
description: Check Node.js for the whiteboard, and debug the local Board Server (start, status, stop, logs) with its command-line tools. For normal use (open the board, talk, draw, stop), use the talk-on-board skill and its tools instead. Use when the user asks to check Node.js for the whiteboard, or to debug the Board Server.
---

# Whiteboard Server (checks and debugging)

Normal use goes through the tools of the MCP server `board-control` and the skill `talk-on-board`: `open_board` starts the board (also for the LAN, with `lan: true`), and `close_board` stops it. Do not give the user the commands below for normal use (R-033).

`SKILL_DIR` below means the folder of this file. Claude Code shows it as the base directory of the skill. Replace it with the full path and keep the double quotes, because the path may contain spaces. Every command is a plain `node` command and prints one JSON line.

Spec: `docs/spec-en.md` in the repository.

## Check Node.js

```
node "SKILL_DIR/scripts/setup.js" --check
```

If `node` is not found, or the result has `"nodeOk": false`: Node.js 20 or later is needed. Show the user the official install command for their OS (Windows: `winget install OpenJS.NodeJS.LTS`, macOS: `brew install node`, Linux: see https://nodejs.org/). Run it only after the user says yes in this chat.

- Before you run it, tell the user: "Windows will ask for administrator approval (a window with a blue and yellow shield). It may open behind other windows. If nothing happens, look for a flashing icon on the taskbar and click Yes." On macOS, `brew` may ask for the user's password in the terminal.
- After the install, `node` may still not be found, because Windows gives the new PATH only to programs started later. Then ask the user to restart Claude Code.

## Debug

These commands are for developers and for tests. With the plugin, the board data is in the folder `board` of the plugin data folder, so pass it with `--data DIR`.

| Command | What it does |
| ------- | ------------ |
| `node "SKILL_DIR/scripts/board.js" status` | The state of the running Server (`pageCount`, `logPath`, `dataDir`). |
| `node "SKILL_DIR/scripts/board.js" start --data DIR` | Starts the Server in the background. Add `--lan` for the LAN (after `setup.js --lan --data DIR`). |
| `node "SKILL_DIR/scripts/board.js" stop` | Saves the board and stops the Server. |
| `node "SKILL_DIR/scripts/setup.js" --lan --data DIR --forge-dir DIR2` | Installs node-forge into DIR2 and makes the LAN certificate in DIR. |

The results of `start` and `status` have the board link with its Token. Never paste it into the chat or onto the board.

## Errors

| `error` | What to do |
| ------- | ---------- |
| `PortInUse` | Another program uses port 47830 or 47831. Tell the user. |
| `RunningInOtherMode` | Stop the Server, then start it again in the mode the user wants. |
| `CertMissing` | Run `setup.js --lan` first. |
| `StartTimeout` | Read the log (`logPath`) and tell the user. |
