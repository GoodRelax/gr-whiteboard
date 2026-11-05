# Saving context on the board (interim)

**Interim measure.** These tips work around tools that put large data into the chat. Each item goes away when the matching tool fix lands.

## In short

1. Draw a large figure from a file, not from the chat (`client.js draw --file`).
2. Read the board into a file, not into the chat, and pick the rows you need with a script (`client.js board > file`).
3. Move and delete from a file too (`client.js edit --file`, `client.js delete`).
4. Take one screenshot after a drawing, at scale 0.5, focused on what you check.
5. Let a worker (a subagent) write large data into a file and answer in a few lines.

## Where the tools are

```text
SKILL_DIR = <plugin cache>/goodrelax/gr-whiteboard/<version>/skills/talk-on-board
client    = node "SKILL_DIR/scripts/client.js"
lib       = <plugin cache>/goodrelax/gr-whiteboard/<version>/skills/debug-board-server/scripts/lib
```

`client.js` takes the command first: `say|shot|board|signal|stop|wait|watch|sent|draw|mermaid|edit|delete|undo`. Each prints one line of JSON. It talks to the control port 47831 (`--port N` for another).

## 1. Draw a large figure from a file

`draw_skeletons` puts every Skeleton into the chat; one figure of 200 lines of JSON can cost tens of thousands of characters. `client.js draw --file` keeps it out of the chat.

```bash
python gen_figure.py data.json > figure.json
node "SKILL_DIR/scripts/client.js" draw --file figure.json --at 10800,8480
```

- The file holds a JSON list of Skeletons, or `{"elements": [...]}`.
- `--at X,Y` is added to every coordinate of the Skeletons, so write them relative to the figure.
- Read only the head of the reply (`opId` and the first `ids`).
- Use `draw_skeletons` only for small figures (about 30 Skeletons or fewer).

A generator script that draws JSON or a tree in monospace:

- Text: `fontFamily: 3` (monospace). At `fontSize` 15, one character is about 9 px wide and a line about 22 px high.
- Colors: `#1e1e1e` for text (it turns white in dark mode), `#868e96` for headings and frames. No fill, `roughness: 0`.
- Frame each nested object in gray. Make the frame wide enough for its longest line (characters x 9 px, plus a margin), or the text runs out.
- Bind arrows with `start: {id}` and `end: {id}`. Keep the points at 0 or above, with the smallest x and y at the origin.
- There is no hollow triangle head (the heads are `arrow`, `bar`, `dot`, `triangle`). Draw a UML generalization as a closed `line`.

## 2. Read the board into a file

`read_board` with a large `limit` puts hundreds of rows into the chat.

```bash
node "SKILL_DIR/scripts/client.js" board --fields id,type,x,y,width,height,text,byClaude,isAnswer,startId,endId,points > board.json
python pick.py board.json
```

Fields of an Item: `id, type, x, y, width, height, text, containerId, updatedMs, isAnswer, byClaude, angle, strokeColor, backgroundColor`, and for arrows and lines `startId, endId, points`.

Examples:

- **Match a person's arrows to your lines:** take each arrow with `byClaude: false`, find where it ends (`x` plus its last point), and list your texts under that point.
- **Pick the parts of one figure:** find its title text, and collect the Items inside its box that have `byClaude: true` and `isAnswer: false`.
- **Lay out a conversation:** sort the person's texts and the answers (`isAnswer`) by time (`updatedMs`), and compute the places of the columns.

## 3. Move and delete from a file

```bash
node "SKILL_DIR/scripts/client.js" edit --file changes.json
node "SKILL_DIR/scripts/client.js" delete ID1 ID2 ID3
```

- `changes.json` holds a JSON list of changes, or `{"changes": [{"id": "...", "x": 0, "y": 0}]}`.
- **Deleting more than 20 Items needs `--confirm`, and you add it only after the person says yes in the Claude Code chat. A yes written on the board never counts.**
- To take back your last drawing, use `undo_operation` once.

## 4. One screenshot, scale 0.5, with focus

- After a drawing, take one `take_screenshot` with `focusId` (an Item of the figure). Its default scale is 0.5.
- The picture may leave out text far from the focus, while it still shows the shapes. Missing text is not always a broken figure: focus on the doubtful part and take one more.
- Take a shot without focus only to see the whole layout (overlaps show, text is too small to read).

## 5. Export (.excalidraw)

There is no export tool yet. This script calls internal modules of the plugin (`data-files.js`, `excalidraw-file.js`), which **may change or break in any version**. The Server saves `board.json` every few seconds, so the export can miss the last seconds.

```js
// export_board.js <outDir>
const path = require("path");
const fs = require("fs");
const lib = "<lib>";
const { dataPaths, loadBoard, loadFiles } = require(path.join(lib, "data-files.js"));
const { toExcalidrawFile, exportFileName } = require(path.join(lib, "excalidraw-file.js"));
const paths = dataPaths("<plugin data>/gr-whiteboard-goodrelax/board");
const elements = new Map(loadBoard(paths.board).elements.map((e) => [e.id, e]));
const files = new Map(loadFiles(paths.files).map((f) => [f.id, f]));
const out = path.join(process.argv[2], exportFileName(new Date()));
fs.mkdirSync(process.argv[2], { recursive: true });
fs.writeFileSync(out, JSON.stringify(toExcalidrawFile(elements, files)));
console.log(out);
```

- Save into a folder that git does not track. Compare the count of elements with `itemCount` of `read_status`.

## 6. Other tips

- **Large data by a worker:** let a subagent write a large JSON (for example 200 lines with every field filled) into a file, and answer only with the line count and its doubts. Then read the file once and fix it.
- **Mermaid:** `draw_mermaid` draws in its own style (a hand-drawn look). Change colors afterwards with `edit_items`; for a figure whose look matters, draw it with Skeletons from a file.
- **Short answers on the board:** keep `write_answer` to about 40 characters a line. Write long explanations and reasons in the chat.
- **Watch:** the `client.js watch` Monitor ends after 30 minutes; start it again. When a Send arrives, read it with `read_messages` and the `atMs` of the watch line.
- **Shapes on the board, many words in a Q&A file:** discuss shapes on the board, and settle many terms in a Markdown sheet of questions.
