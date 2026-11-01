"use strict";

// LAN addresses and the Board URLs. See spec FR-044 to FR-046.

// `interfaces` is the result of os.networkInterfaces(), passed in so this function stays pure.
// @purity pure
function lanAddresses(interfaces) {
  const addresses = [];
  for (const list of Object.values(interfaces || {})) {
    for (const info of list || []) {
      const isV4 = info.family === "IPv4" || info.family === 4;
      if (isV4 && !info.internal && !info.address.startsWith("169.254.")) addresses.push(info.address);
    }
  }
  return [...new Set(addresses)].sort();
}

// The Token is in the part after "#", so the browser does not send it with the page request
// and it does not appear in a Referer header.
// @purity pure
function boardUrls({ lan, port, token, addresses }) {
  const fragment = `/#t=${token}`;
  if (!lan) return { local: `http://127.0.0.1:${port}${fragment}`, lan: [] };
  return {
    local: `https://localhost:${port}${fragment}`,
    lan: addresses.map((address) => `https://${address}:${port}${fragment}`),
  };
}

// The kind of a network interface, from its name (0.7.1, FR-163). Names differ by OS; a wrong guess only
// changes a label, because the recommended address comes from the route (see joinTargets).
const VIRTUAL_NAME = /vethernet|virtual|vmware|vmnet|vbox|hyper-v|wsl|docker|podman|^br-|virbr|utun|tailscale|zerotier/i;
const WIFI_NAME = /wi-?fi|wlan|wireless|airport|^wl/i;
const WIRED_NAME = /ethernet|^eth|^en\d|^enp|^eno/i;
const KIND_LABEL = Object.freeze({
  wifi: "Wi-Fi",
  wired: "Wired LAN",
  other: "Other network",
  virtual: "Virtual switch (usually not reachable from other devices)",
});
const KIND_ORDER = Object.freeze(["wifi", "wired", "other", "virtual"]);

// @purity pure
function kindOf(name) {
  if (VIRTUAL_NAME.test(name)) return "virtual";
  if (WIFI_NAME.test(name)) return "wifi";
  if (WIRED_NAME.test(name)) return "wired";
  return "other";
}

// The LAN addresses with the name of their interface: [{ address, name }], as lanAddresses chooses them.
// @purity pure
function lanInterfaces(interfaces) {
  const seen = new Map();
  for (const [name, list] of Object.entries(interfaces || {})) {
    for (const info of list || []) {
      const isV4 = info.family === "IPv4" || info.family === 4;
      if (isV4 && !info.internal && !info.address.startsWith("169.254.") && !seen.has(info.address)) seen.set(info.address, name);
    }
  }
  return [...seen].map(([address, name]) => ({ address, name })).sort((a, b) => (a.address < b.address ? -1 : 1));
}

// What the "Join" dialog shows for each LAN address (FR-163): the Board URL, the URL of the CA file over http
// (caPort; null without it), the interface name, its kind and label, and whether it is the recommended address
// (the one that the default route uses). The recommended address comes first, then by kind.
// @purity pure
function joinTargets({ interfaces, port, caPort, token, routeAddress }) {
  const targets = interfaces.map(({ address, name }) => {
    const kind = kindOf(name);
    return {
      url: `https://${address}:${port}/#t=${token}`,
      caUrl: caPort ? `http://${address}:${caPort}/ca.crt` : null,
      address,
      name,
      kind,
      label: KIND_LABEL[kind],
      recommended: address === routeAddress,
    };
  });
  return targets.sort((a, b) => Number(b.recommended) - Number(a.recommended)
    || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.address < b.address ? -1 : 1));
}

module.exports = { lanAddresses, lanInterfaces, boardUrls, joinTargets, kindOf };
