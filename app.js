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

      var state = document.createElement("div");
      state.className = server.address ? "addr" : "state";
      state.textContent = server.address || server.label;
      meta.appendChild(state);

      row.appendChild(meta);

      var button = document.createElement("button");
      var online = server.status === "online";
      var moving = server.status === "queued" || server.status === "starting";

      button.textContent = online ? "Stop" : moving ? "Starting…" : "Start";
      button.disabled = moving || busy[server.name];
      if (online) button.className = "ghost";

      button.addEventListener("click", function () {
        act(online ? "stop" : "start", server.name, button);
      });
      row.appendChild(button);

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
