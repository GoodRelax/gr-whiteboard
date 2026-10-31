# whiteboard-chat-for-claude - Specification (ANMS v0.34)

| Item     | Value                                   |
| -------- | --------------------------------------- |
| Document | spec-en.md                              |
| Template | ANMS v0.34 (gr-sw-maker process-rules)  |
| Version  | 0.4.1 (draft)                           |
| Date     | 2026-10-30                              |
| Status   | Draft. A person must review it.         |
| License  | Apache-2.0                              |

Writing rule: this document uses plain English. Sentences are short. Words are common. Each term has one meaning (see 1.8).

Section numbers: review-standards-en.md uses Ch5.x for design. In this document, design is in Ch3.x. Ch5.1 = 3.1, Ch5.3 = 3.2, Ch5.5 = 3.4, Ch5.6 = 3.7.

---

## Chapter 1. Foundation

### 1.1 Background

Claude Code is an AI coding tool. People talk to it in its own chat window.
A person who thinks on a whiteboard must move between the board and the chat. This is slow.

Excalidraw is a whiteboard. Its drawing part is a free React component on npm (`@excalidraw/excalidraw`, MIT license).

An earlier project (excalidraw-room-chat) let Claude Code join a room on excalidraw.com with a browser that had no window.
It worked, but the excalidraw.com terms of use do not allow bots and scripts to use the site, or the making and sharing of such tools.
So this project does not use excalidraw.com at all. It runs its own small board on the user's computer (decision R-001).

### 1.2 Problems

- C-1: Claude Code cannot see a whiteboard. It cannot write on it.
- C-2: Excalidraw draws text on a canvas. A program cannot read the text from the page.
- C-3: Claude Code starts work only when something happens. Something must tell it "a person wrote text".
- C-4: A new user may have nothing installed. Setup must be short and must explain each step.

### 1.3 Goals

| ID  | Goal | Measure |
| --- | ---- | ------- |
| G-1 | A person writes on the board, and Claude Code answers on the same board. | `MessageReceived` within 2.5 s after the person stops typing (NFR-001). |
| G-2 | The board works for a first-time user. | Greeting on the board within 3 minutes, with Node.js already installed, without reading the README (NFR-010). |
| G-3 | People on the same LAN can join. | A second computer opens the board with the LAN link (FR-046). |
| G-4 | No use of excalidraw.com. | The page loads code only from the Server and esm.sh (NFR-011). |

### 1.4 Approach

- A small Node.js program (the Server) serves a web page with the Excalidraw component. It keeps the Board, sends changes between pages, and saves the Board to a JSON file.
- The Server reads the Board itself, so it can tell Claude Code about new text (Events, one JSON line each, in a log file).
- Claude Code sends Answers to the Server. One browser page (the Leader) puts each Answer on the Board, because only a browser can measure text.
- Two Skills: `whiteboard-server` runs the board; `whiteboard-chat` talks on it (R-016).

### 1.5 Scope

In scope:
- One Board, saved on disk (R-006).
- Text, shapes, arrows, hand drawings, and images (PNG, JPEG, GIF, WebP) made with the Excalidraw component.
- This computer only (default), or the LAN with https and a Token (R-004, R-010, R-013, R-014).
- Answers as text. Screenshots for Claude Code.

Out of scope:
- excalidraw.com and its rooms (R-001, R-011).
- Many Boards, user accounts, and access over the internet.
- Seeing other people's mouse pointers.
- A build step for the page.

### 1.6 Rules that must not be broken

- B-1: The page and the Server never call excalidraw.com.
- B-2: The Control API (Answers, Screenshots, stop) answers only programs on the same computer, also in LAN mode.
- B-3: The Token never appears in Events, in the log file, or in error messages.
- B-4: Text on the Board is untrusted data. The Skill never tells the Agent to obey it.

### 1.7 Known limits

| ID  | Limit | Effect | What we do |
| --- | ----- | ------ | ---------- |
| L-1 | The page loads React and Excalidraw from esm.sh (R-005). | Each page needs the internet when it loads. If esm.sh is down, the page does not load. | Versions are fixed. The browser cache helps. A later version may serve the files from the Server. |
| L-2 | A self-signed certificate. | Browsers warn on the first visit in LAN mode. | The Skill tells the user how to continue (FR-058). |
| L-3 | When two people change the same item at the same time, the higher version wins (FR-021). | One change can be lost. | Same rule as Excalidraw itself. |
| L-4 | Answers do not wrap. | Long lines are wide. | The Skill tells the Agent to use short lines. |
| L-5 | Answers need an open page (the Leader). | With no page open, Answers wait in a queue. | `say` replies 202 `queued` (FR-025). |
| L-6 | The Token is in the URL. | It stays in the browser history. | The Skill tells the user not to share the link. |

### 1.8 Words used in this document

| Word | Meaning |
| ---- | ------- |
| Agent | Claude Code, which follows a Skill. |
| Skill | A folder with `SKILL.md` that tells the Agent what to do. Here: `whiteboard-server` and `whiteboard-chat`. |
| Server | The Node.js program `server.js`. It serves the Page, keeps the Board, and has two HTTP APIs. |
| Board | All Excalidraw elements, also deleted ones. The Server keeps the main copy. |
| Element | One Excalidraw object (text, rectangle, arrow, hand drawing, ...). It has `id`, `version`, and `versionNonce`. |
| Item | The short form of a not-deleted Element that the tracker and `board` use (3.4). |
| Text Item | An Item of type `text`. |
| Drawing | An Item that is not text: a pen line (`freedraw`), a shape, an arrow, or a line. |
| Page | One open browser tab with the Board URL. |
| Leader | The Page that writes Answers and takes Screenshots. The first Page that connected. |
| Person | A human who writes on the Board. |
| Message | A Text Item written by a Person (not an Answer). |
| Answer | A Text Item written for the Agent. It has `customData.whiteboardChat = "answer"`. |
| Job | A task for the Leader: write an Answer, or take a Screenshot. |
| Event | One JSON line that the Server writes to its output and its log file. |
| Token | A random secret. Pages need it to read or change the Board. |
| Board URL | The link to the Page, with the Token after `#t=`. |
| Settled | A Text Item has not changed for `settleMs`. |
| LAN mode | The Server listens on all network addresses with https. |

### 1.9 Notation

This document follows RFC 2119 and RFC 8174. SHALL and MUST mean "required". SHOULD means "recommended". MAY means "allowed". In EARS sentences, `shall` means SHALL.

Decision IDs (R-001 to R-018) refer to the design Q&A that the owner answered on 2026-10-30.

---

## Chapter 2. Requirements

How to check each requirement: T = test, I = inspection (a person reads it), A = analysis, D = demonstration.

### 2.1 Functional Requirements

#### Start and stop

| ID     | Requirement (EARS) | Check |
| ------ | ------------------ | ----- |
| FR-001 | When `board.js start` runs and no Server answers on the control port, `board.js` shall start `server.js` in the background, wait until the Server is Ready, and print the Board URL. | T, D |
| FR-002 | When `board.js start` runs and a Server in the same mode is running, `board.js` shall print the same result with `alreadyRunning: true` and start nothing. | D |
| FR-003 | If `board.js start` runs and a Server in the other mode (LAN or not) is running, then `board.js` shall print error `RunningInOtherMode` and start nothing. | D |
| FR-004 | When the Server starts, the Server shall mark every Text Item of the saved Board as already reported. | T |
| FR-005 | When both HTTP servers listen, the Server shall send `ServerReady` with the package version, the mode, the ports, and the number of Items. | T |
| FR-006 | When the Server receives `POST /v1/stop`, the Server shall reply 202, reject waiting Jobs with `Stopping`, send `bye` to every Page, save the Board, send `ServerStopped`, and exit with code 0. | T |
| FR-007 | When the Server receives SIGINT or SIGTERM, the Server shall stop as in FR-006. | I |
| FR-008 | If a port is in use, then the Server shall send `ServerFailed` with reason `PortInUse` and exit with code 4. | D |
| FR-009 | If a setting is not valid (4.2), then the Server shall send `ServerFailed` with reason `InvalidConfig` and exit with code 2. | T |
| FR-009a | If a Text Item or Drawing first appears after the start but was last changed more than 30 s before the Server started, then the Server shall treat it as old and not report it. Reason: a Page that stayed open can send its Board again after a restart. | T |

#### Finding Messages

| ID     | Requirement (EARS) | Check |
| ------ | ------------------ | ----- |
| FR-010 | While the Server is Ready, the Server shall check the Board every `tickMs`. | T |
| FR-011 | When a Text Item that was never reported becomes Settled with text that is not blank, the Server shall send `MessageReceived`. | T |
| FR-012 | When a reported Text Item becomes Settled with text that is different from the last reported text, the Server shall send `MessageEdited`. | T |
| FR-013 | While a Person on any Page is typing in a Text Item, the Server shall not report that Text Item. | T |
| FR-014 | The Server shall not report Answers. | T |
| FR-015 | If a Text Item is blank (empty or only spaces), then the Server shall not report it. | T |
| FR-016 | When the number of Drawings goes up, the Server shall send `DrawingAdded` with the new number and the increase. A Drawing is every Item that is not text: pen lines, rectangles, diamonds, ellipses, arrows, and lines. Moving, changing, or deleting a Drawing does not count. | T |

#### Keeping Pages in step

| ID     | Requirement (EARS) | Check |
| ------ | ------------------ | ----- |
| FR-020 | When a Page sends Elements that change the Board, the Server shall send those Elements to every other Page. | T |
| FR-021 | When the Server gets an Element that it already has, the Server shall keep the one with the higher `version`; for the same `version`, the one with the lower `versionNonce`. This is the rule of Excalidraw. | T |
| FR-022 | When a Page connects, the Server shall send it the whole Board and tell it whether it is the Leader. | T |
| FR-023 | When the Board changes on a Page, the Page shall send the changed Elements to the Server within 150 ms, and again after 1 s if sending failed. | D |
| FR-023a | When the event stream of a Page is closed for good (`readyState` CLOSED), or no message (also `ping`) came for 50 s, the Page shall open a new stream. The Server shall send a `ping` event every 20 s. | D |
| FR-024 | If an Element from a Page has no string `id` (1 to 64 characters), no string `type`, no integer `version`, or no number `versionNonce`, then the Server shall ignore that Element. | T |

#### Answers

| ID     | Requirement (EARS) | Check |
| ------ | ------------------ | ----- |
| FR-025 | When the Server receives `POST /v1/say` with a valid body, the Server shall add an Answer Job. It shall reply 200 with the Element IDs and the Board Point when the Leader finishes within 8 s; otherwise it shall reply 202 with `queued: true`, and the Job stays in the queue. | T |
| FR-026 | If the text is missing, blank, or longer than `maxTextChars`, or `at` is not two numbers, or the body is not JSON, then the Server shall reply 400 (`InvalidText`, `InvalidAt`, `InvalidJson`) and add no Job. | T |
| FR-027 | The Server shall give Jobs to the Leader one at a time, in the order they came. | T |
| FR-028 | When the Leader gets an Answer Job, the Leader shall wait until the Answer font (Excalifont, and Xiaolai for Chinese and Japanese) is loaded for the text, then make one Text Item with `convertToExcalidrawElements` (font size 20, blue `#1971c2`, mark `customData.whiteboardChat = "answer"`), add it to its Board, and send it to the Server with the Job result. | D |
| FR-029 | If an Item covers the Board Point of an Answer (with a 10 px margin), then the Server shall move the point down below that Item, again until no Item covers it. | T |
| FR-030 | Where `say` has no `at`, the Server shall choose the Board Point by the rule in 4.6 (chat style: right below the newest Message, `answerIndentPx` to the left). On an empty Board it shall use (100, 100). | T |
| FR-031 | When the Server receives `POST /v1/shot` and a Page is open, the Leader shall export the Board as PNG (at most 2000 px on the long side, white background), and the Server shall save it in `shotDir` and reply with the file path. If no Page is open, the Server shall reply 503 `NoPage`. | T, D |
| FR-032 | Where `shot` has `focusId`, the Leader shall export only Items that overlap a 1600 x 1000 box around the center of that Item. If no Item has that ID, the Job shall fail (`JobFailed`). | D |
| FR-033 | If the Leader does not finish a Job within `jobTimeoutMs`, then the Server shall end the Job with `JobTimeout` and send `AnswerFailed` for an Answer Job. | T |
| FR-034 | The Leader shall be the first Page that is on screen (FR-085), or the first Page when no Page is on screen. When the Leader leaves, the Server shall make the next Page the Leader and give it the running Job again. When the Leader changes, the Server shall send `role` to the old and the new Leader. | T |
| FR-085 | When a Page is shown or hidden, the Page shall post `/api/visibility`, and the Server shall choose the Leader again (FR-034). A new Page tells it with `visible` in the stream query. Reason (live test, 0.4.0): Edge froze the Leader in a hidden tab, and every Answer timed out while the iPad page was awake. | T |
| FR-086 | If a Page does not finish a Job in time, then the Server shall send `JobRetried` and give the Job once to another Page; with no other Page, or after the second try, the Job fails with `JobTimeout`. If the first Page finishes the Job late, the Server refuses it (409), and that Page takes its Answer off its Board, so the Answer is on the Board once. | T |
| FR-035 | When a new Answer appears on a Page outside the visible area, the Page shall scroll to it. | D |
| FR-028a | When a Page becomes the Leader, it shall measure every Answer again with the loaded font and make any Answer that is too small as wide and high as its text. Reason: Answers measured before the font loaded were cut at the right end. | D |
| FR-036 | When the Server receives `GET /v1/board`, the Server shall reply with all Items and the number of Pages. | T |
| FR-038 | When the Server receives `POST /v1/signal` with `state` `reading`, `working`, `waiting`, or `none`, the Server shall send it to every Page, and every Page shall show it in the top right (`none` shows nothing). New Pages get it with `hello`. Other values get 400 `InvalidSignal`. | T |
| FR-039 | When an Answer is posted, the Server shall set the Signal to `waiting`. | T |
| FR-037 | If the request path or method is not in 4.3 or 4.4, then the Server shall reply 404 `NotFound`. | I |

#### Send

| ID     | Requirement (EARS) | Check |
| ------ | ------------------ | ----- |
| FR-070 | While automatic sending is off (the default), the Server shall not send `MessageReceived`, `MessageEdited`, or `DrawingAdded`. Reason: a Person often writes one thought in several texts and drawings, and the Agent answered too early. | T |
| FR-071 | While automatic sending is off, the Server shall send every Page the number of changes since the Baseline (4.10), and the Page shall show it on the Send button ("Send (3)"), left of the Signal. Text that someone is typing is not counted. | T, D |
| FR-072 | When a Person presses Send, the Page shall finish the text that is being typed, send its last changes, and post `/api/send`; the Server shall then send one `MessagesSent` with every change since the Baseline (4.10) and make the Board the new Baseline. With no change, it shall send nothing. | T |
| FR-073 | When a Person presses Ctrl+Shift+Enter (Cmd+Shift+Enter on a Mac), also while typing, the Page shall do as FR-072 and keep the key from Excalidraw. Checked on 2026-10-30: Excalidraw 0.18.1 has no Ctrl+Shift+Enter (with Ctrl, it treats the key as Ctrl+Enter, "finish editing" or "edit line points"); Chrome uses Ctrl+Shift+Enter only in the address bar; Edge does not list it. | I, D |
| FR-074 | Where a Person turns on "auto" on a Page, the Server shall send each Message by itself when it is Settled (FR-011 to FR-016), send the changes since the Baseline at once, and show the setting on every Page. It is off when the Server starts. When it is turned off again, the Board becomes the new Baseline. | T |
| FR-075 | The changes shall cover every item, also the Agent's Answers: added, edited, deleted, moved, resized, rotated, restyled, and reshaped. Reason (the owner): a Person deleted an arrow in a diagram without noticing, and the wrong diagram would have become the spec. | T |
| FR-076 | The Server shall keep the Baseline (the Board at the last Send, as summaries) in `baseline.json`, so a restart does not lose unsent changes. An Answer that the Leader writes shall go into the Baseline at once, because it is not news for the Agent. | T |
| FR-077 | In `MessagesSent`, the Server shall list the added texts first, in the order the Server got them, and then the other changes, sorted by kind (edited texts, deleted texts, added drawings, changed items, deleted drawings), and in each kind from top to bottom. Reason (the owner): read the new words first to know the situation, then check the other changes. | T |

#### Images

| ID     | Requirement (EARS) | Check |
| ------ | ------------------ | ----- |
| FR-080 | The Page shall show the image tool, and a Person shall put an image on the Board with the tool, by paste, or by drop. Reason (the owner): a Person wants to paste a part of a spec and talk about it. | D |
| FR-081 | When a Page has an image file that the Server does not have, the Page shall post it to `/api/files`; the Server shall then send it to every other Page as SSE `files`, and every Page shall add it to its Board. `hello` shall carry every file. | T |
| FR-082 | The Server shall save each new file at once as `files/<id>.json` and load the files when it starts, so images come back after a restart. | T |
| FR-083 | The Server shall take only PNG, JPEG, GIF, and WebP files whose `dataURL` matches the type, at most 8 MB of `dataURL` text each and 200 MB on the Board, and shall send `FileRejected` for any other file. SVG is left out, because an SVG file can hold scripts and links. | T |
| FR-084 | An image on the Board shall count as a Drawing: Send lists it as `added` with `type: "image"`, and its moves and other changes as `changed`; a new picture in the same image is `restyled` with `fileId`. The Agent takes a Screenshot to see it. | T |

#### Saving

| ID     | Requirement (EARS) | Check |
| ------ | ------------------ | ----- |
| FR-040 | While the Board has unsaved changes, the Server shall save the whole Board to `board.json` every `saveMs`, through a temporary file, and also when it stops. | T |
| FR-041 | If `board.json` cannot be read, then the Server shall rename it to `board.json.broken-<ms>`, start with an empty Board, and send `BoardWarning`. | I |
| FR-042 | When the Server starts, the Server shall drop deleted Elements whose last change is older than 7 days. | T |

#### Access and safety

| ID     | Requirement (EARS) | Check |
| ------ | ------------------ | ----- |
| FR-044 | Where LAN mode is off, the Server shall serve the Page with http on 127.0.0.1 only. | T |
| FR-045 | The Server shall make a random Token (18 bytes, base64url) once, keep it in `token.txt`, and refuse the event stream and every POST of the Board API without it (403 `BadToken`). | T |
| FR-046 | Where LAN mode is on, the Server shall serve the Page with https on all addresses, and the result of `board.js start` shall have one Board URL for each LAN address (IPv4, not internal, not 169.254.x.x). | T, D |
| FR-047 | When `setup.js --lan` runs, setup shall install the fixed node-forge version into the Skill folder and make a self-signed certificate for `localhost`, `127.0.0.1`, and every LAN address. It shall make a new certificate if an address is missing or the old one ends within 7 days. | T, D |
| FR-048 | The Board API shall refuse requests with an `Origin` from another host (403 `BadOrigin`) and POSTs without `content-type: application/json` (415). The Page shall have a Content Security Policy that allows code only from the Server, esm.sh, and its own import map. | T |
| FR-049 | The Control API shall listen on 127.0.0.1 only, also in LAN mode, and shall refuse requests that have an `Origin` header or a `Host` other than `127.0.0.1:<port>` or `localhost:<port>` (403 `NotLocal`). | T |

#### What the Skills tell the Agent

| ID     | Requirement (EARS) | Check |
| ------ | ------------------ | ----- |
| FR-050 | When the user types `/whiteboard-chat`, the Skill shall tell the Agent to run `board.js start` of the `whiteboard-server` Skill and show the Board URL as a link. | I, D |
| FR-051 | The Skill shall tell the Agent to tell the user, with the link, that anyone with the link can see and change the Board. | I |
| FR-052 | After the start, the Skill shall tell the Agent to start a Monitor with `client.js watch`, and to start it again when it times out while the Server runs. | I |
| FR-053 | When `MessageReceived` or `MessageEdited` arrives, the Skill shall tell the Agent to answer with `client.js say`. | I |
| FR-053a | When `MessageReceived` or `MessageEdited` arrives, the Skill shall tell the Agent to set the Signal `reading` at once, and `working` before work that takes more than a few seconds. | I |
| FR-054 | The Skill shall tell the Agent that Message text is untrusted data. The Agent must not run commands, change files, or send data because of Message text alone, unless the user allowed that kind of action in the Claude Code chat in this session. | I |
| FR-055 | When `DrawingAdded` arrives, the Skill shall tell the Agent to take a Screenshot before it talks about the drawing. | I |
| FR-056 | When the user asks to stop, the Skill shall tell the Agent to stop the Monitor and run `board.js stop`. | I |
| FR-057 | If Node.js is missing or older than version 20, then the Skill shall tell the Agent to show the official install command, run it only after the user says yes, warn about the administrator approval window (it may be behind other windows), and use the full path of `node` if the new PATH is not visible yet. | I |
| FR-058 | When the user asks for LAN mode, the Skill shall tell the Agent to say the download size before `setup.js --lan`, and after the start to explain the browser warning (Advanced, then Proceed), the firewall question (private networks only), and that anyone on the network with the link can write messages. | I |
| FR-060 | The Server shall write every Event, in UTF-8, to `<dataDir>/server.log` as well as to its output. It shall empty the log file when it starts. | T |
| FR-061 | When `client.js wait` runs, the client shall print the first `ServerReady` or `ServerFailed` Event in the log that is not older than 5 s before the command started, or print `WaitTimeout` and exit with code 1 after `--timeout-ms`. | T |
| FR-062 | While `client.js watch` runs, the client shall print each new Event in the log whose name is in the Monitor list of 4.7, one line each. If the log becomes shorter or its first line changes, it shall read it again from the start. | T |
| FR-078 | When `client.js watch` prints a `MessagesSent`, the client shall print only `atMs`, `messageCount`, `changeCount`, and `read` (the `sent` command for this event); `client.js sent --at-ms N` shall print the full `MessagesSent` with that `atMs` (the last one without `--at-ms`), and `NoSent` with exit code 1 if there is none. Reason: a Monitor cut long events, and the Agent missed changes (R-011). | T |
| FR-063 | Every step of both Skills shall be a plain `node` command, so that it works in bash, PowerShell, and cmd. | I |
| FR-064 | `setup.js --check` shall finish without using the network. | I |

### 2.2 Non-Functional Requirements

| ID      | Type          | Requirement | Check |
| ------- | ------------- | ----------- | ----- |
| NFR-001 | Speed         | The Server shall send `MessageReceived` within `settleMs + tickMs + 500` ms after the last change of the text reaches the Server. With default values, this is 2250 ms. | T |
| NFR-002 | Speed         | While a Leader is open, the Server shall reply to `say` within 3000 ms for text of up to 500 characters on a Board with up to 500 Items. | D |
| NFR-003 | Memory        | The Server shall use less than 150 MB of memory over 8 hours and 1000 Messages. | D |
| NFR-004 | Memory        | The tracker shall remove deleted Items at the next check. Its size shall never be larger than the number of Text Items on the Board. | T |
| NFR-005 | Security      | The Server shall not write the Token to Events, the log file, or error replies. Only `GET /v1/status` (local only) has the Board URL. | T |
| NFR-006 | Versions      | Every Event and every Control API reply shall have `"v": 1`. If a reader sees an unknown `v`, the reader shall treat it as a breaking change. | T |
| NFR-007 | Versions      | `ServerReady` and `/v1/status` shall have the `version` value from `package.json` of `whiteboard-server`. | T |
| NFR-008 | Platforms     | The Server shall run on Windows 11, macOS 14, and Ubuntu 22.04 with Node.js 20 or later. The Page shall work in the latest Chrome, Edge, Firefox, and Safari. | D |
| NFR-009 | Supply chain  | Versions are fixed: `@excalidraw/excalidraw` 0.18.1 and React 19.2.8 (esm.sh URLs), node-forge 1.4.0 (`package.json`). The Server has no other dependencies. Each fixed version was at least two weeks old when chosen. | I |
| NFR-010 | Ease of use   | A new user who has Claude Code and Node.js 20+ shall see the greeting on the Board within 3 minutes, without reading the README. | D |
| NFR-011 | Independence  | The Page shall load code only from the Server and esm.sh, and shall connect only to the Server and esm.sh (Content Security Policy). | T, I |
| NFR-012 | Disk          | The Skills shall write files only in their own folders (`.data/`, `.run/`, `node_modules/`), in the temp folder (`shotDir`), and in the npm cache. | I |

---

## Chapter 3. Architecture

### 3.1 Architecture Type

Clean Architecture, small. Four rings:

| Ring | Files |
| ---- | ----- |
| Entity | `message-tracker.js`, `answer-placement.js`, `board-store.js`, `board-diff.js`, `board-files.js` |
| Use Case | `board-hub.js`, the tracker loop in `server.js` |
| Adapter | `board-api.js`, `control-api.js`, `event-sink.js`, `data-files.js`, `http-util.js` |
| Framework and drivers | `server.js` (wiring), Node `http`/`https`, the Page (`page/app.js` with Excalidraw) |

Inner rings do not import outer rings. `board-hub.js` gets the event sink and the clock from outside.

```mermaid
graph LR
  P1["Page (Leader)<br/>Excalidraw component"] -->|"POST /api/elements<br/>POST /api/job"| BA["Board API<br/>board-api.js"]
  BA -->|"SSE: hello, elements,<br/>role, job, bye"| P1
  P2["Other Page<br/>(this PC or LAN)"] -->|"POST /api/elements"| BA
  BA -->|"SSE: hello, elements"| P2
  BA -->|"calls"| HUB["BoardHub<br/>board-hub.js"]
  HUB -->|"merges into"| ST["Board<br/>board-store.js"]
  TR["Tracker loop<br/>message-tracker.js"] -->|"reads Items"| ST
  TR -->|"Events"| EV["Event sink<br/>server.log"]
  HUB -->|"Events"| EV
  CA["Control API<br/>127.0.0.1 only"] -->|"say, shot"| HUB
  CL["client.js"] -->|"HTTP"| CA
  CL -->|"watch reads"| EV
  AG["Agent<br/>(Claude Code)"] -->|"runs"| CL
  ST -->|"saved every saveMs"| DF["board.json"]
```

### 3.2 Components

| Component | Ring | Job |
| --------- | ---- | --- |
| MessageTracker | Entity | Decides which Text Items are new or changed Messages (3.4.3). Pure functions. |
| AnswerPlacement | Entity | Finds the Board Point for an Answer (4.6). Pure functions. |
| BoardDiff | Entity | Compares the Board with the Baseline and lists the changes for Send (FR-070 to FR-077, 4.10). Pure functions. |
| BoardFiles | Entity | Checks the image files and keeps them within the limits (FR-080 to FR-084). Pure functions. |
| BoardStore | Entity | Checks and merges Elements (FR-021, FR-024). Makes Items. |
| BoardHub | Use Case | Knows the Pages and the Leader. Sends Board changes to Pages. Runs Jobs one at a time (3.4.2). |
| Tracker loop | Use Case | Every `tickMs`: Items without Answers, plus the IDs being typed, into MessageTracker; Events out. |
| BoardApi | Adapter | Serves the Page. Event stream and POSTs for Pages. Checks Token and Origin. |
| ControlApi | Adapter | Local HTTP API for `client.js` and `board.js`. |
| EventSink | Adapter | Writes Events as JSON lines. Removes the Token. |
| DataFiles | Adapter | `board.json`, `token.txt`, certificate files. |
| Page | Driver | Shows Excalidraw. Sends and receives Elements. On the Leader: writes Answers, takes Screenshots. |
| board.js | Tool | Starts, stops, and checks the Server. |
| setup.js | Tool | Checks Node.js. Prepares LAN mode. |
| client.js | Tool (Skill `whiteboard-chat`) | `say`, `shot`, `board`, `stop`, `wait`, `watch`. |

### 3.3 Files

```text
whiteboard-chat-for-claude/
  README.md, LICENSE, NOTICE, package.json (tests only), .gitignore
  docs/spec-en.md
  skills/
    whiteboard-server/
      SKILL.md
      package.json            node-forge (only for LAN mode)
      page/index.html         import map (esm.sh), styles
      page/app.js             the Page
      scripts/server.js       the Server
      scripts/board.js        start | status | stop
      scripts/setup.js        --check | --lan
      scripts/lib/*.js        components of 3.2
      .data/                  (made at run time, not in git) board.json, token.txt, server.log, cert files
    whiteboard-chat/
      SKILL.md
      scripts/client.js
      .run/                   (made at run time, not in git) answer.txt
  test/unit/*.test.js, test/integration/*.test.js
```

Both Skill folders go side by side in the Claude Code skills folder. `whiteboard-chat` finds the Server at `../whiteboard-server`.

### 3.4 Data Model

Element: an Excalidraw element as the Page sends it. The Server reads only `id`, `type`, `version`, `versionNonce`, `isDeleted`, `x`, `y`, `width`, `height`, `text`, `containerId`, `updated`, and `customData.whiteboardChat`. It stores the rest as it is.

Item (made from a not-deleted Element):

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `id` | string | Element ID. |
| `type` | string | `text`, `rectangle`, `freedraw`, ... |
| `x`, `y`, `width`, `height` | number | Board coordinates. |
| `text` | string or null | Text of a Text Item; null for other types. |
| `containerId` | string or null | The shape that holds this text; null if none. |
| `updatedMs` | number | Last change time (the Page's clock). |
| `isAnswer` | boolean | True for Answers. |

TrackerState: for each Text Item ID, `reportedText` (null if never reported), `pendingText` (null if the text equals `reportedText`), `pendingSinceMs`; plus `drawingCount` and `notBeforeMs`.

Job: `id` (integer, from 1), `kind` (`answer` or `shot`), `text` and `at` (answer), `focusId` (shot), `pageId` (while running), `point` (answer, while running).

#### 3.4.1 ServerStateMachine

```mermaid
stateDiagram-v2
    [*] --> Starting : process starts
    Starting --> Ready : ListenOk
    Starting --> Failed : ListenFailed
    Starting --> Failed : ConfigInvalid
    Ready --> Stopping : StopRequested
    Stopping --> Stopped : Saved
    Stopped --> [*] : exit 0
    Failed --> [*] : exit 2, 3, 4, or 6
```

| Event \ State | Starting | Ready | Stopping |
| ------------- | -------- | ----- | -------- |
| ConfigInvalid | Failed / send ServerFailed(InvalidConfig), exit 2 | - | - |
| CertMissing   | Failed / send ServerFailed(CertMissing), exit 3 | - | - |
| ListenFailed  | Failed / send ServerFailed(PortInUse or Internal), exit 4 or 6 | - | - |
| ListenOk      | Ready / send ServerReady | - | - |
| StopRequested | - | Stopping / stop timers, reject Jobs, send bye, close streams | - |
| Saved         | - | - | Stopped / send ServerStopped, exit 0 |

#### 3.4.2 JobStateMachine (one for each Job)

```mermaid
stateDiagram-v2
    [*] --> Queued : say or shot
    Queued --> Running : LeaderFree
    Running --> Done : JobOk
    Running --> Ended : JobFailed
    Running --> Ended : JobTimeout
    Running --> Queued : LeaderLeft
    Queued --> Ended : Stopping
    Running --> Ended : Stopping
    Done --> [*] : resolved
    Ended --> [*] : rejected
```

| Event \ State | Queued | Running |
| ------------- | ------ | ------- |
| LeaderFree (a Leader exists and no Job runs) | Running [first in queue] / answer: choose Board Point; send `job` to the Leader; start timer | - |
| JobOk         | - | Done / answer: merge the Answer, send it to other Pages, send AnswerPosted; start the next Job |
| JobFailed     | - | Ended / send AnswerFailed (answer); start the next Job |
| JobTimeout    | - | Ended / send AnswerFailed (answer); start the next Job |
| LeaderLeft    | - | Queued [front of queue] / stop timer; the next Page becomes Leader |
| Stopping      | Ended / reject `Stopping` | Ended / reject `Stopping` |

#### 3.4.3 TrackedTextStateMachine (one for each Text Item that is not an Answer)

```mermaid
stateDiagram-v2
    [*] --> New : first seen after start
    [*] --> Reported : on the Board at start
    New --> New : TextChanged / restart timer
    New --> Reported : Settled [not blank, not typing] / send MessageReceived
    Reported --> Changed : TextChanged
    Changed --> Changed : TextChanged / restart timer
    Changed --> Reported : Settled [not blank, not typing] / send MessageEdited
    Changed --> Reported : TextRestored
    New --> [*] : ItemDeleted
    Reported --> [*] : ItemDeleted
    Changed --> [*] : ItemDeleted
```

| Event \ State | New | Reported | Changed |
| ------------- | --- | -------- | ------- |
| TextChanged   | - / pendingText = text, pendingSinceMs = now | Changed / pendingText = text, pendingSinceMs = now | - / pendingText = text, pendingSinceMs = now |
| TextRestored  | - | - | Reported / pendingText = null |
| Settled       | Reported [not blank and not typing] / reportedText = text, send MessageReceived; - [blank or typing] | - | Reported [not blank and not typing] / reportedText = text, send MessageEdited; - [blank or typing] |
| ItemDeleted   | removed / - | removed / - | removed / - |

`Settled` happens when `nowMs - pendingSinceMs >= settleMs`. `TextRestored` happens when the text becomes the same as `reportedText` again. "Typing" means the ID is in `editingIds`: some Page has it open in the text editor (FR-013). A Text Item that first appears with `updatedMs < notBeforeMs` starts in Reported (FR-009a).

### 3.5 Behavior

#### Message and Answer flow

```mermaid
sequenceDiagram
    participant Person
    participant Page as Page (Leader)
    participant Server
    participant Agent as Agent (Monitor + client.js)
    Person->>Page: types "What is 2+3?"
    Page->>Server: POST /api/elements (changed text, editingId)
    Person->>Page: leaves the text editor
    Page->>Server: POST /api/elements (editingId null)
    Server->>Server: tracker: Settled after settleMs
    Server->>Agent: Event MessageReceived (log line, read by watch)
    Agent->>Server: POST /v1/say {"text": "5"}
    Server->>Page: SSE job {jobId, text, x, y}
    Page->>Page: convertToExcalidrawElements, updateScene
    Page->>Server: POST /api/job {ok, elements}
    Server->>Agent: 200 {ids, x, y}
```

#### Page start

1. The Page reads the Token from `#t=`. Without it, the Page shows "This page needs the full link ...".
2. When the Excalidraw API is ready, the Page opens `GET /api/stream?t=<Token>&page=<random id>`.
3. On `hello`, the Page merges the Board with `reconcileElements` (Excalidraw's rule; it keeps the text that is being typed here), marks the Server versions as known, and sends Elements that the Server does not have yet.
4. After that, on every change, it sends the Elements whose `version` is not the known one.
5. When the stream breaks, the browser opens it again after 2 s. The next `hello` brings the Board again.

### 3.6 The Page

- Plain browser module. No build. `index.html` has an import map: `react`, `react-dom`, and `@excalidraw/excalidraw` from esm.sh, fixed versions (R-005, NFR-009).
- Excalidraw options: the image tool is on (FR-080); in the top right, the Signal (FR-038: "Claude: reading your text" yellow, "Claude: working on it" blue, "Claude: waiting for you" green; every label is "Claude: verb + object", so it is clear who does what) and a status label ("connected", "this page writes Claude's answers", or "not connected, trying again").
- Answer Job: see FR-028. Screenshot Job: see FR-031, FR-032.

### 3.7 Decisions

#### ADR-000: Compare with the smallest design

The smallest design is "the Agent reads and writes `board.json` while a static page shows it". It cannot work: the Page must get changes at once, and text size must be measured in a browser. The next smallest is this design: one Server, no database, no WebSocket library, one Leader that writes.

#### ADR-001: Own board with the Excalidraw component, no excalidraw.com

- Context: the excalidraw.com terms do not allow bots and scripts, or making and sharing them. Self-hosting the MIT component is allowed.
- Decision: the Server serves its own Page with `@excalidraw/excalidraw`. Nothing calls excalidraw.com (R-001, R-011).
- Result: we must sync Pages ourselves (ADR-002). The name does not start with "Excalidraw" (R-002).

#### ADR-002: The Server keeps the Board; Server-Sent Events and POST

- Context: Pages must see each other's changes. The Agent must see text without a browser.
- Decision: the Server keeps every Element. Pages get changes with Server-Sent Events and send changes with POST. Node only, no dependencies.
- Alternatives: WebSocket (needs a library or much code); a Page as the main copy (the Agent could not read the Board while no Page is open).
- Result: the merge rule must match Excalidraw (FR-021).

#### ADR-003: The Leader Page writes Answers

- Context: the width and height of text depend on fonts. Only a browser measures them right.
- Decision: the first Page writes each Answer with `convertToExcalidrawElements`. When it leaves, the next Page takes over. With no Page, Answers wait (R-007).
- Result: `say` can reply 202 (L-5). A Page that runs a Job must stay open until it ends; otherwise the Job moves to the next Leader.

#### ADR-004: Load the component from esm.sh, fixed versions

- Decision: no build and no install for the default mode (R-005). Versions are in the URLs.
- Result: L-1. The Content Security Policy allows esm.sh and nothing else outside.

#### ADR-005: A Token for every Page, also on this computer

- Context: R-004 asks for a Token for the LAN. On 127.0.0.1, any web site in the user's browser could still send requests to the Server, and other programs on the computer could too.
- Decision: every Page needs the Token. It is in the URL after `#`, so the browser does not send it in requests or in the Referer header. The Board API also checks `Origin` (FR-045, FR-048).
- Result: the user must open the full link once. The Token stays the same across restarts.

#### ADR-006: https only in LAN mode, self-signed, node-forge

- Context: browsers treat http on other computers as not safe, and some functions do not work (R-013). Browsers treat `127.0.0.1` as safe.
- Decision: http on 127.0.0.1 (default); https on all addresses in LAN mode (R-014). `setup.js --lan` installs node-forge (BSD-3-Clause; chosen from its dual license) and makes the certificate (R-015). Node itself makes the key.
- Result: L-2. The default mode needs no npm install.

#### ADR-007: Two Skills in one repository

- Decision: `whiteboard-server` runs the Board. `whiteboard-chat` talks on it and starts the Server when it is not running (R-016). One name, one kind of work.
- Result: both folders must be installed side by side.

#### ADR-008: Apache-2.0 license

- Decision: Apache-2.0, for its patent grant.

---

## Chapter 4. Specification

### 4.1 Scenarios

```gherkin
Feature: Talk with Claude Code on a local whiteboard

  Background:
    Given the Server runs with default settings
    And one Page is open with the Board URL

  Rule: Start

    Scenario: SC-001 Old text is not reported (traces: FR-004, FR-005)
      Given board.json has a Text Item "old note"
      When the Server starts
      Then the Server sends ServerReady with itemCount 1
      But the Server sends no MessageReceived for "old note"

    Scenario: SC-002 Start twice (traces: FR-001, FR-002)
      Given the Server runs
      When board.js start runs again
      Then the result has alreadyRunning true and the same url

    Scenario: SC-003 Port in use (traces: FR-008)
      Given another program listens on port 47830
      When board.js start runs
      Then the result has error PortInUse

  Rule: Finding Messages

    Scenario: SC-010 A new text (traces: FR-011, NFR-001)
      When a Person writes "What is 2+3?" and leaves the text editor
      Then within 2250 ms the Server sends MessageReceived with text "What is 2+3?"

    Scenario: SC-011 Text that is being typed (traces: FR-013)
      Given a Person types "hel" and stops for 3 s without leaving the editor
      Then the Server sends no MessageReceived
      When the Person types "lo" and leaves the editor
      Then the Server sends one MessageReceived with text "hello"

    Scenario: SC-012 An edit (traces: FR-012)
      Given "hello" was reported
      When a Person changes it to "hello world"
      Then the Server sends MessageEdited with text "hello world"

    Scenario: SC-013 Answers are not Messages (traces: FR-014)
      When the Agent says "hi"
      Then the Server sends no MessageReceived for "hi"

    Scenario: SC-014 A drawing (traces: FR-016)
      When a Person draws two lines with the pen
      Then the Server sends DrawingAdded with added 2

  Rule: Answers

    Scenario: SC-020 Answer below the newest Message, a little to the left (traces: FR-025, FR-028, FR-030)
      Given the newest Message is at (1410, 500) with height 25
      When the Agent says "5"
      Then the Leader makes a blue Text Item "5" at (1240, 537)
      And say replies 200 with its id

    Scenario: SC-021 No Page open (traces: FR-025, FR-034)
      Given no Page is open
      When the Agent says "hi"
      Then say replies 202 with queued true
      When a Page opens
      Then the Page writes "hi"
      And the Server writes AnswerPosted to the log

    Scenario: SC-022 The Leader closes (traces: FR-034)
      Given two Pages are open
      When the first Page closes
      Then the second Page shows "this page writes Claude's answers"

    Scenario: SC-023 Blank text (traces: FR-026)
      When the Agent says "   "
      Then say replies 400 with error InvalidText

    Scenario: SC-024 Screenshot (traces: FR-031)
      When the Agent runs client.js shot
      Then the reply has a path to a PNG file of the Board

  Rule: Two Pages

    Scenario: SC-030 Changes reach the other Page (traces: FR-020, FR-023)
      Given two Pages are open
      When a Person writes "From page two" on the second Page
      Then the first Page shows "From page two" within 1 s

    Scenario: SC-031 Same Element, two changes (traces: FR-021)
      Given the Server has Element "a" with version 3 and versionNonce 5
      When a Page sends "a" with version 3 and versionNonce 4
      Then the Server keeps the one with versionNonce 4 and sends it to the other Pages

  Rule: Safety

    Scenario: SC-040 No Token (traces: FR-045)
      When a request opens /api/stream with a wrong Token
      Then the Server replies 403 BadToken

    Scenario: SC-041 Another web site (traces: FR-048, FR-049)
      When a request with Origin "https://evil.example" posts to /api/elements
      Then the Server replies 403 BadOrigin
      When a request with an Origin header posts to /v1/say
      Then the Server replies 403 NotLocal

    Scenario: SC-042 Token not in the log (traces: NFR-005)
      When the Server has run SC-010 and SC-020
      Then server.log does not contain the Token

  Rule: Saving

    Scenario: SC-050 The Board comes back (traces: FR-040, FR-006)
      Given the Board has "hello" and the Answer "hi"
      When board.js stop runs and board.js start runs
      Then the Page shows "hello" and "hi"

  Rule: LAN

    Scenario: SC-060 LAN mode (traces: FR-046, FR-047)
      Given setup.js --lan was run
      When board.js start --lan runs
      Then the result has one https lanUrl for each LAN address
      And a second computer opens it after the certificate warning
```

### 4.2 Settings

Flags of `server.js` (and of `board.js start`, which passes them on):

| Flag | Default | Range | Meaning |
| ---- | ------- | ----- | ------- |
| `--lan` | off | switch | LAN mode (https on all addresses). |
| `--port` | 47830 | 1024-65535 | Port of the Board API and the Page. |
| `--control-port` | 47831 | 1024-65535, not `--port` | Port of the Control API (127.0.0.1). |
| `--data` | `<skill>/.data` | folder | Data folder (4.5). |
| `--tick-ms` | 250 | 50-10000 | Tracker interval. |
| `--settle-ms` | 1500 | 0-60000 | Time without change before a text is Settled. |
| `--save-ms` | 3000 | 100-600000 | Save interval. |
| `--job-timeout-ms` | 15000 | 1000-120000 | Time for the Leader to finish a Job. |
| `--max-text-chars` | 2000 | 1-20000 | Longest Answer. |
| `--answer-gap-px` | 12 | 0-1000 | Space between a Message and its Answer, and between Answers. |
| `--answer-indent-px` | 170 | 0-2000 | How far an Answer starts to the left of its Message. |
| `--shot-dir` | `<temp>/whiteboard-chat` | folder | Where Screenshots go. |

### 4.3 Board API (port `--port`)

| Method and path | Token | Body | Reply |
| --------------- | ----- | ---- | ----- |
| `GET /`, `GET /index.html` | no | - | The Page (HTML), with the Content Security Policy. |
| `GET /app.js` | no | - | The Page script. |
| `GET /api/stream?t=<Token>&page=<id>` | query | - | Server-Sent Events: `hello {pageId, leader, signal, inbox, elements}`, `inbox {unsent, autoSend}`, `elements {elements}`, `role {leader}`, `job {jobId, kind, text, x, y}` or `job {jobId, kind, focusId}`, `signal {state}`, `ping {}` (every 20 s), `bye {}`. `id` is 8 to 64 of `A-Za-z0-9_-`. |
| `POST /api/elements` | header `x-board-token` | `{page, elements, editingId}` | `{v, changed}` |
| `POST /api/send` | header `x-board-token` | `{page}` | `{v, sent}` (FR-072) |
| `POST /api/auto-send` | header `x-board-token` | `{page, on}` | `{v, autoSend}` (FR-074) |
| `POST /api/visibility` | header `x-board-token` | `{page, visible}` | `{v}` (FR-085) |
| `POST /api/files` | header `x-board-token` | `{page, files: [{id, mimeType, dataURL, created}]}` | `{v, added, rejected: [{id, reason}]}` (FR-081) |
| `POST /api/job` | header `x-board-token` | `{page, jobId, ok, elements}` (answer), `{page, jobId, ok, png}` (shot, base64), or `{page, jobId, ok: false, error}` | `{v}`; 409 `UnknownJob` if the Job does not run on that Page. |

The Page and the Page script need no Token, because they have no Board data. Bodies: at most 8 MB (`elements`), 32 MB (`job`), and 40 MB (`files`).

### 4.4 Control API (`127.0.0.1:<control-port>`)

| Method and path | Body | Reply |
| --------------- | ---- | ----- |
| `GET /v1/status` | - | `{v, state, version, lan, port, controlPort, url, lanUrls, pageCount, queueLength, signal, autoSend, unsent, itemCount, dataDir, logPath, shotDir}` |
| `GET /v1/board` | - | `{v, items, pageCount}` |
| `POST /v1/say` | `{text, at?: {x, y}}` | 200 `{v, jobId, ids, x, y}` or 202 `{v, queued: true, jobId, pageCount}` |
| `POST /v1/shot` | `{focusId?}` | 200 `{v, path}` |
| `POST /v1/signal` | `{state}`: `reading`, `working`, `waiting`, or `none` | 200 `{v, state}` |
| `POST /v1/stop` | - | 202 `{v}` |

### 4.5 Data files (`--data`)

| File | Content |
| ---- | ------- |
| `board.json` | `{"v": 1, "elements": [...]}`. Written through `board.json.tmp` and a rename. |
| `token.txt` | The Token and a line break. |
| `baseline.json` | `{"v": 1, "items": [summary, ...]}`: the Board at the last Send (FR-076). |
| `files/<id>.json` | `{id, mimeType, dataURL, created}`: one image file (FR-082). |
| `server.log` | Events (4.7), UTF-8, emptied at each start. |
| `cert.pem`, `key.pem`, `cert-info.json` | LAN mode only. `cert-info.json`: `{addresses, createdMs, notAfterMs}`. The certificate is valid for 397 days. |

### 4.6 Rules: where to put an Answer

Like a chat on a phone: the Person's text is on the right, Claude's Answers are on the left (the owner's request in the live test).

1. If `say` has `at`: start at `at`.
2. Else, if the Board has no Items: (100, 100).
3. Else, the anchor is the newest Message (a Text Item that is not an Answer); if there is none, the newest Item that is not an Answer; if there is none, the newest Answer.
4. Start at x = anchor x - `answerIndentPx` (no indent when the anchor is an Answer), y = anchor bottom + `answerGapPx`. On the Board, x may be below 0.
5. The expected size of the Answer is about 0.55 x 20 px per character of its longest line, and 25 px per line.
6. While an Item (with a 10 px margin) overlaps that box, move the box down to the bottom of that Item + `max(answerGapPx, 11)`. So a second Answer to the same Message goes below the first.

### 4.7 Events (output, one JSON object per line)

Every Event has `v: 1`, `event`, and `atMs`.

| Event | Fields | In the Monitor list |
| ----- | ------ | ------------------- |
| `ServerReady` | `version, lan, port, controlPort, itemCount, lanAddressCount` | yes |
| `ServerStopped` | - | yes |
| `ServerFailed` | `reason, message` | yes |
| `MessagesSent` | `messages: [{id, text, x, y, inShape}]`, `changes: [{kind, id, type, x, y, isAnswer, ...}]` (FR-072, 4.10) | yes |
| `MessageReceived`, `MessageEdited` | `id, text, x, y, inShape` (auto sending only) | yes |
| `DrawingAdded` | `drawingCount, added` (auto sending only) | yes |
| `PageJoined`, `PageLeft` | `pageCount` | yes |
| `AnswerQueued` | `jobId, pageCount` | no |
| `AnswerPosted` | `jobId, ids, x, y` | no |
| `AnswerFailed` | `jobId, error, message` | yes |
| `SaveFailed` | `message` | yes |
| `FileRejected` | `id, reason` (FR-083) | yes |
| `JobRetried` | `jobId, kind` (FR-086) | no |
| `BoardWarning` | `message` | yes |

### 4.8 Errors

| Code | HTTP | When |
| ---- | ---- | ---- |
| `InvalidJson` | 400 | The body is not a JSON object. |
| `InvalidText` | 400 | Text missing, blank, or too long. |
| `InvalidAt` | 400 | `at` is not two numbers. |
| `InvalidSignal` | 400 | Signal is not `reading`, `working`, `waiting`, or `none`. |
| `BadPageId` | 400 | Page ID missing or wrong. |
| `BadToken` | 403 | Token missing or wrong. |
| `BadOrigin` | 403 | Request from another web site. |
| `NotLocal` | 403 | Control API request from a browser or with a wrong Host. |
| `NotFound` | 404 | Unknown path or method. |
| `UnknownJob` | 409 | A Job result for a Job that does not run on that Page. |
| `TooLarge` | 413 | Body too large. |
| `BadContentType` | 415 | POST without `application/json`. |
| `JobFailed` | 502 | The Leader could not do the Job. |
| `NoPage` | 503 | Screenshot with no open Page. |
| `Stopping` | 503 | The Server is stopping. |
| `JobTimeout` | 504 | The Leader did not finish in time. |
| `Internal` | 500 | Any other error. |

Exit codes of `server.js`: 0 ok, 2 `InvalidConfig`, 3 `CertMissing`, 4 `PortInUse`, 6 `Internal`.

### 4.9 Setup

| Command | Network | Result |
| ------- | ------- | ------ |
| `setup.js --check` | no | `{v, ok, node, nodeOk, lanReady, forge, cert, lanAddresses}` |
| `setup.js --lan` | npm (once) | `{v, ok, step, madeCert, lanAddresses, tail}`. On failure, `step` is `node`, `npm`, or `address`, and `tail` has the last 20 lines of output. |

The default mode needs nothing but Node.js 20 or later. LAN mode downloads node-forge (about 2 MB) into `whiteboard-server/node_modules`.

What the Agent shows a new user (Skill `whiteboard-chat`):
1. The Board URL as a link, and: "Open this link in your browser. Write on the board with the text tool (T). I will answer on the board. Anyone who has the link can see and change the board, so do not share it."
2. A greeting on the Board.
3. In the chat: "Write on the board. Say 'stop' here to end."

### 4.10 Changes since the last Send

The Baseline holds a summary of each item that is not deleted: `id, type, x, y, width, height, angle, text, containerId, isAnswer, style, shape` (`style`: strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle, roughness, opacity, fontSize, fontFamily, textAlign, fileId; `shape`: the points of a line, arrow, or pen drawing, rounded to whole pixels).

| `kind` | When | Fields besides `id, type, x, y, isAnswer` |
| ------ | ---- | ----------------------------------------- |
| (in `messages`) | A new text that is not blank and not an Answer. | `text, inShape` |
| `edited` | The text of an item changed. | `text, oldText`, and `what`/`from`/`style` if it also changed in other ways |
| `deleted` | The item was in the Baseline and is gone now. | `text` (for text) |
| `added` | A new item that is not text. | `width, height` |
| `changed` | `what`: `moved` (x or y by 3 px or more; `from` has the old place), `resized` (width or height by 3 px or more; not for text, whose size follows its words), `rotated` (0.01 rad or more), `restyled` (`style` lists the fields), `reshaped` (other points). | `what, from, style` |

Not listed: smaller moves, version-only changes (for example the order of layers), a text inside a shape that moved with the shape, and items that someone is typing in (they stay for the next Send).

---

## Chapter 5. Test Strategy

| Test level       | What | How | Tool | Pass when |
| ---------------- | ---- | --- | ---- | --------- |
| Unit test        | MessageTracker, AnswerPlacement, BoardStore, BoardHub, config, LAN helpers, API checks | Every cell of the 3.4.2 and 3.4.3 tables. Edge values: empty Board, blank text, `settleMs` 0, equal versions. BoardHub with fake Pages and a fake clock. | `node:test` | All pass |
| Integration test | `server.js` as a child process; `client.js wait` and `watch` | A fake Page (SSE and POST) and the Control API: sync, Messages, typing, Answers, Token, Origin, saving. | `node:test` | All pass |
| Manual test      | The Page in real browsers | Two Pages: sync, Answers, Screenshot, Leader change, restart; LAN mode from a second computer. | Browser | Scenarios in 4.1 pass |
| Inspection       | FR-050 to FR-064, NFR-009, NFR-011 | A person reads both `SKILL.md` files, one full session log, `index.html`, and `package.json`. | Reading | No finding of High or higher |

Tests do not depend on each other. They share no state. Their order does not matter. Unit tests do not wait for real time.

Run: `npm test` in the repository root (Node.js 20 or later). No install is needed.

---

## Chapter 6. Design Principles Check

| Area | Principle | Planned action | Status |
| ---- | --------- | -------------- | ------ |
| Names | Naming | Names follow the word list (1.8). Event names are in past tense. Numbers with units have the unit in the name (`settleMs`, `answerGapPx`). | - |
| Dependencies | Dependency direction | Entity files import only Entity files. BoardHub gets the event sink and the clock from outside. | - |
| Simple | KISS / YAGNI | One Board, no accounts, no WebSocket library, no build (1.5). | - |
| Simple | DRY | The merge rule is only in `board-store.js` (the Page uses Excalidraw's own `reconcileElements`, which has the same rule). | - |
| Separate | SRP / SoC | Each component has one job (3.2). | - |
| Coupling | CQS | `toItems` and `editingIds` only read. `mergeElements` changes the Board and returns what changed. | - |
| Purity | Purity tags | Every server function has a `@purity` tag. Entity functions and config reading are `pure`. | - |
| States | State transitions | `trackMessages` decides; `emit` acts. Job states are in one place (BoardHub). | - |
| Concurrency | Safe concurrency | Node runs one thing at a time. Jobs run one at a time (FR-027). No `await` between reading and changing the Board. | - |
| Errors | Error handling | See 4.8. A Job promise that nobody waits for any more cannot stop the Server. | - |
| Resources | Open and close in pairs | Timers, streams, and both HTTP servers close on stop. | - |
| Security | Secrets | The Token is removed from Events and error messages (NFR-005). The Control API is local only (B-2). | - |

---

## Appendix

### A.1 References

1. gr-sw-maker, `process-rules/spec-template-en.md` and `process-rules/review-standards-en.md`.
2. Excalidraw: https://github.com/excalidraw/excalidraw, package `@excalidraw/excalidraw`.
3. esm.sh: https://esm.sh/
4. node-forge: https://github.com/digitalbazaar/forge
5. Mavin, A., et al. "EARS: Easy Approach to Requirements Syntax", IEEE, 2009.
6. Cucumber, "Gherkin Reference": https://cucumber.io/docs/gherkin/reference/
7. RFC 2119, RFC 8174. HTML Living Standard, "Server-sent events".

### A.2 Licenses

| Part | License | In this repository | Notice needed |
| ---- | ------- | ------------------ | ------------- |
| This project | Apache-2.0 | yes | LICENSE, NOTICE |
| `@excalidraw/excalidraw` | MIT | no (the browser loads it from esm.sh) | Credit in README ("Powered by Excalidraw (MIT)") |
| React | MIT | no (from esm.sh) | no |
| node-forge | BSD-3-Clause or GPL-2.0; we use BSD-3-Clause | no (npm installs it in LAN mode) | no (not shipped) |

"Excalidraw" is a trademark of its owners. This project is not made by, endorsed by, or connected with Excalidraw.

### A.3 Changes

| Version | Date | Change |
| ------- | ---- | ------ |
| 0.4.1 | 2026-10-31 | The Leader is the first Page on screen (FR-034, FR-085), and a Job that times out goes once to another Page (FR-086). Reason: in the LAN test, Edge froze the Leader in a hidden tab, and Answers timed out while the iPad page was awake. The owner chose this fix from four options (R-012). |
| 0.4.0 | 2026-10-31 | Images on the Board (FR-080 to FR-084): the image tool is on; pages share image files through the Server, which checks and saves them. Reason (the owner, in the live test of 0.3.1): "I cannot paste images; I want to point at a part of the spec." |
| 0.3.1 | 2026-10-31 | `watch` prints `MessagesSent` as a short line, and the new `client.js sent` prints the full event (FR-078). Reason: in the live test, a Monitor cut a long `MessagesSent`, so the Agent did not get every change. The owner chose this fix (R-011). |
| 0.3.0 | 2026-10-30 | Chat-style placement (4.6, FR-030), as the owner asked in the live test: the Answer goes right below the newest Message, 170 px to the left. Default `answerGapPx` 40 -> 12. New `answerIndentPx`. Signal labels and names changed to "reading your text" (`reading`), "working on it" (`working`), "waiting for you" (`waiting`): "your turn" did not say whose turn, and "read" can be an order and has no clear tense. All three are "Claude: verb-ing + object". FR-029 now checks the expected size of the Answer, not only its corner. Live test: shapes did not count for Send, because only pen lines were Drawings; FR-016 now counts every Item that is not text. Added Send (FR-070 to FR-077, 4.10): nothing goes to the Agent until the Person presses Send or Ctrl+Shift+Enter; then one `MessagesSent` has the new texts first, then every other change since the last Send (the owner chose "tell every change", also moves, deletions, and colors, and set the reading order). "auto" keeps the old behavior. Reason: the Agent answered while the Person was still writing. |
| 0.2.0 | 2026-10-30 | Live test with the owner. Answers written soon after a Page opened were cut at the right end (measured before Excalifont loaded): added the font wait to FR-028 and FR-028a. An Edge Page lost its event stream after about 70 s and did not open it again: added FR-023a (ping event, watchdog). Added the Signal (FR-038, FR-039, FR-053a), as the owner asked. |
| 0.1.0 | 2026-10-30 | First version. Replaces excalidraw-room-chat (which used excalidraw.com with Playwright). Decisions R-001 to R-018. Kept from the old project: MessageTracker (now with `editingIds` for many Pages), AnswerPlacement, EventSink, `client.js` (`wait`, `watch`, `say`). |
