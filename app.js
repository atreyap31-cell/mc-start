/* Front end for the Aternos starter.
 *
 * GitHub Pages is static, so this page holds no secrets and does no work - it
 * just calls the API running on the host machine. The passphrase and the API
 * address live in this browser's localStorage and are sent only to that API.
 */

(function () {
  "use strict";

  // The cloudflared tunnel to the host machine. When the tunnel restarts it
  // gets a new address - change this line and push, or paste the new one into
  // Connection settings on the page.
  var DEFAULT_API = "https://aluminum-authorized-put-tooth.trycloudflare.com";

  var POLL_MS = 10000;

  var els = {
    sub: document.getElementById("sub"),
    banner: document.getElementById("banner"),
    list: document.getElementById("list"),
    pass: document.getElementById("pass"),
    api: document.getElementById("api"),
    save: document.getElementById("save")
  };

  var busy = {};

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) {
      return null; // private mode, or storage blocked
    }
  }

  function apiBase() {
    var saved = store("api") || DEFAULT_API;
    return (saved || "").replace(/\/+$/, "");
  }

  function say(message, ok) {
    if (!message) {
      els.banner.hidden = true;
      return;
    }
    els.banner.hidden = false;
    els.banner.textContent = message;
    els.banner.className = ok ? "banner ok" : "banner";
  }

  function request(path, options) {
    var base = apiBase();
    if (!base) return Promise.reject(new Error("no-api"));
    return fetch(base + path, options).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (body) {
          if (!response.ok) {
            var error = new Error(
              body.error || "Request failed (" + response.status + ")"
            );
            // The host's Aternos login lapsed - nothing can start until they
            // sign in again, so the page should say that, not "error".
            error.needsLogin = body.needs_login === true;
            throw error;
          }
          return body;
        });
    });
  }

  function act(verb, name, button) {
    var passphrase = els.pass.value.trim();
    if (!passphrase) {
      say("Enter the passphrase first.");
      els.pass.focus();
      return;
    }
    store("pass", passphrase);
    busy[name] = true;
    button.disabled = true;
    button.textContent = verb === "start" ? "Starting…" : "Stopping…";

    request("/api/" + verb, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server: name, passphrase: passphrase })
    })
      .then(function (body) {
        if (verb === "start") {
          say(
            body.queued
              ? body.server +
                  " is queued with Aternos. Free servers wait their turn - this " +
                  "page updates when it comes online."
              : body.server + " is online at " + body.address,
            true
          );
        } else {
          say(body.server + " is shutting down.", true);
        }
      })
      .catch(function (error) {
        say(error.message === "no-api" ? noApiMessage() : error.message);
      })
      .then(function () {
        busy[name] = false;
        refresh();
      });
  }

  function noApiMessage() {
    return "No API address set - open Connection settings and paste the tunnel address.";
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      try {
        var scratch = document.createElement("textarea");
        scratch.value = text;
        scratch.setAttribute("readonly", "");
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        document.body.appendChild(scratch);
        scratch.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(scratch);
        ok ? resolve() : reject(new Error("copy refused"));
      } catch (e) {
        reject(e);
      }
    });
  }

  function copyText(text) {
    // navigator.clipboard needs a secure context AND permission. It can exist
    // and still reject (embedded browsers, locked-down settings), so fall
    // through to execCommand on rejection rather than only on absence.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text);
      });
    }
    return legacyCopy(text);
  }

  function copyButton(address) {
    var button = document.createElement("button");
    button.className = "copy";
    button.type = "button";
    button.textContent = "Copy";
    button.title = "Copy " + address;
    button.setAttribute("aria-label", "Copy address " + address);

    button.addEventListener("click", function (event) {
      // Don't let the click reach the row and trigger anything else.
      event.stopPropagation();
      copyText(address)
        .then(function () {
          button.textContent = "Copied";
          button.classList.add("copied");
        })
        .catch(function () {
          // Clipboard blocked: select it so they can copy by hand.
          button.textContent = "Select it";
          var node = button.previousSibling;
          if (node && window.getSelection) {
            var range = document.createRange();
            range.selectNodeContents(node);
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        })
        .then(function () {
          setTimeout(function () {
            button.textContent = "Copy";
            button.classList.remove("copied");
          }, 1500);
        });
    });
    return button;
  }

  function render(servers) {
    if (!servers.length) {
      els.list.innerHTML = '<div class="empty">No servers on the account.</div>';
      return;
    }
    els.list.innerHTML = "";

    servers.forEach(function (server) {
      var row = document.createElement("div");
      row.className = "server";

      var dot = document.createElement("span");
      dot.className = "dot " + server.status;
      row.appendChild(dot);

      var meta = document.createElement("div");
      meta.className = "meta";

      var name = document.createElement("div");
      name.className = "name";
      name.textContent = server.name;
      meta.appendChild(name);

      // The address shows whether or not the server is up, so people can put
      // it in Minecraft first and start it after.
      if (server.address) {
        var addrRow = document.createElement("div");
        addrRow.className = "addr-row";

        var addr = document.createElement("span");
        addr.className = "addr";
        addr.textContent = server.address;
        addrRow.appendChild(addr);

        addrRow.appendChild(copyButton(server.address));
        meta.appendChild(addrRow);
      }

      var state = document.createElement("div");
      state.className = "state";
      state.textContent = server.label;
      meta.appendChild(state);

      row.appendChild(meta);

      var online = server.status === "online";
      var moving = server.status === "queued" || server.status === "starting";

      if (online) {
        // Visitors start servers, they don't stop them - somebody could be
        // mid-game. Aternos shuts an empty server down by itself.
        var badge = document.createElement("span");
        badge.className = "badge-online";
        badge.textContent = "Running";
        row.appendChild(badge);
      } else {
        var button = document.createElement("button");
        button.textContent = moving ? "Starting…" : "Start";
        button.disabled = moving || busy[server.name];
        button.addEventListener("click", function () {
          act("start", server.name, button);
        });
        row.appendChild(button);
      }

      els.list.appendChild(row);
    });
  }

  function refresh() {
    if (!apiBase()) {
      els.sub.textContent = "Not connected";
      els.list.innerHTML = '<div class="empty">' + noApiMessage() + "</div>";
      return;
    }
    request("/api/servers")
      .then(function (body) {
        els.sub.textContent = "Updated " + new Date().toLocaleTimeString();
        render(body.servers || []);
      })
      .catch(function (error) {
        if (error.needsLogin) {
          // The machine is up and answering - only the Aternos login lapsed.
          els.sub.textContent = "Host needs to sign in";
          els.list.innerHTML =
            '<div class="empty">The host is online, but their Aternos sign-in ' +
            "has expired. Nothing can start until they log in again.</div>";
          say(error.message);
          return;
        }
        els.sub.textContent = "Not connected";
        els.list.innerHTML =
          '<div class="empty">Can\'t reach the host machine. It may be switched ' +
          "off, or the tunnel address may have changed.</div>";
        if (error.message !== "no-api") say(error.message);
      });
  }

  els.save.addEventListener("click", function () {
    var value = els.api.value.trim().replace(/\/+$/, "");
    store("api", value);
    say("Saved.", true);
    refresh();
  });

  els.pass.addEventListener("change", function () {
    store("pass", els.pass.value.trim());
  });

  els.api.value = store("api") || DEFAULT_API || "";
  els.pass.value = store("pass") || "";

  refresh();
  setInterval(refresh, POLL_MS);
})();
