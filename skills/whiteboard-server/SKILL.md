---
name: whiteboard-server
description: Start, stop, or check the local whiteboard (Board Server) that Claude Code can read and write. The board runs on this computer (or on the LAN with --lan) and uses the Excalidraw component (MIT). Use when the user asks to start, stop, restart, or open the whiteboard, to open it to the LAN, or asks for the board link. To talk with Claude on the board, use the whiteboard-chat skill.
---

# Whiteboard Server

This skill runs the board. It does not talk on the board; the skill `whiteboard-chat` does that.

`SKILL_DIR` below means the folder of this file. Claude Code shows it as the base directory of the skill. In every command, replace `SKILL_DIR` with that full path and keep the double quotes, because the path may contain spaces.

Every command is a plain `node` command. It works the same in bash, PowerShell, and cmd. Each command prints one JSON line.

Spec: `docs/spec-en.md` in the repository.

## Check Node.js

```
node "SKILL_DIR/scripts/setup.js" --check
```

If `node` is not found, or the result has `"nodeOk": false`: Node.js 20 or later is needed. Show the user the official install command for their OS (Windows: `winget install OpenJS.NodeJS.LTS`, macOS: `brew install node`, Linux: see https://nodejs.org/). Run it only after the user says yes in this chat.

- Before you run it, tell the user: "Windows will ask for administrator approval (a window with a blue and yellow shield). It may open behind other windows. If nothing happens, look for a flashing icon on the taskbar and click Yes." On macOS, `brew` may ask for the user's password in the terminal.
- After the install, `node` may still not be found, because Windows gives the new PATH only to programs started later. Then use the full path of node (Windows: `"C:\Program Files\nodejs\node.exe"`) in place of `node` for the rest of this session. If that also fails, ask the user to restart Claude Code.

## Start

Only this computer (the default):

```
node "SKILL_DIR/scripts/board.js" start
```

The Server keeps running in the background after the command ends. The result has `url`. Show it to the user as a link and say: "Open this link in your browser. It works only on this computer. Anyone who has the link can see and change the board, so do not share it."

### Open to the LAN

Only when the user asks for other computers to join.

1. Run `node "SKILL_DIR/scripts/setup.js" --check`. If `"lanReady": false`, tell the user: "I will download node-forge (about 2 MB, into the skill folder) and make a self-signed certificate." Then run:

   ```
   node "SKILL_DIR/scripts/setup.js" --lan
   ```

   If the result has `"ok": false`, show the user `step` and `tail`, and stop.
2. If the Server is running without LAN, stop it first (see "Stop").
3. Start it:

   ```
   node "SKILL_DIR/scripts/board.js" start --lan
   ```

4. Show the user `url` (for this computer) and `lanUrls` (for other computers) and say:
   - "The browser will warn that the connection is not private, because the certificate is self-signed. Click **Advanced**, then **Proceed** (or **Continue**). Do this once on each computer."
   - "Windows may ask whether Node.js can use the network. Allow it for private networks only."
   - "Anyone on your network who has this link can see and change the board, and can write messages to me."

## Status

```
node "SKILL_DIR/scripts/board.js" status
```

`pageCount` is the number of open browser pages. `url` is the board link.

## Stop

```
node "SKILL_DIR/scripts/board.js" stop
```

The board is saved in `SKILL_DIR/.data/board.json` and comes back at the next start. To clear the board, the user can select everything in the browser and delete it.

## Errors

| `error` | What to do |
| ------- | ---------- |
| `PortInUse` | Another program uses port 47830 or 47831. Start with `--port N --control-port M` (other free ports), and tell the user. |
| `RunningInOtherMode` | Stop the Server, then start it again in the mode the user wants. |
| `CertMissing` | Run `setup.js --lan` first. |
| `StartTimeout` | Read the log (`logPath`) and tell the user. |
