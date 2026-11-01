"use strict";

// ExcalidrawFile (Entity). The Board as an `.excalidraw` file, the format that excalidraw.com opens
// (type "excalidraw", version 2). Pure. Used when the Server stops after the idle time (0.6.1, FR-161).

const SOURCE = "https://github.com/GoodRelax/gr-whiteboard";

// elements: Map id -> Element. files: Map id -> file ({ id, mimeType, dataURL, created }).
// Only Elements that are not deleted, and only the files that they show.
// @purity pure
function toExcalidrawFile(elements, files) {
  const kept = [...elements.values()].filter((element) => !element.isDeleted);
  const used = new Set(kept.filter((element) => element.type === "image" && element.fileId).map((element) => element.fileId));
  const fileList = {};
  for (const id of used) {
    const file = files.get(id);
    if (file) fileList[id] = { id: file.id, mimeType: file.mimeType, dataURL: file.dataURL, created: file.created };
  }
  return {
    type: "excalidraw",
    version: 2,
    source: SOURCE,
    elements: kept,
    appState: { viewBackgroundColor: "#ffffff", gridSize: null },
    files: fileList,
  };
}

// The file name for a stop at `date` (local time): whiteboard-YYYYMMDD-HHMMSS.excalidraw.
// @purity pure
function exportFileName(date) {
  const two = (n) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`;
  const time = `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
  return `whiteboard-${day}-${time}.excalidraw`;
}

module.exports = { toExcalidrawFile, exportFileName };
