const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { Client } = require("@colyseus/sdk");
const { WorldState } = require("shared");
process.env.NODE_ENV = "production";
const { createGameServer } = require("../dist/index.js");

async function smoke() {
  const { gameServer, httpServer } = createGameServer();
  let room;
  try {
    await gameServer.listen(0, "127.0.0.1");
    const endpoint = `http://127.0.0.1:${httpServer.address().port}`;
    const health = await fetch(`${endpoint}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    const page = await fetch(endpoint);
    assert.equal(page.status, 200);
    const html = await page.text();
    const asset = html.match(/src="([^"]+\.js)"/)[1];
    const script = await fetch(`${endpoint}${asset}`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    assert.equal(script.status, 200);
    assert.equal(script.headers.get("content-encoding"), "gzip");
    assert.match(script.headers.get("cache-control"), /immutable/);
    await script.arrayBuffer();
    assert.equal((await fetch(`${endpoint}/colyseus`)).status, 404);
    room = await new Client(endpoint).joinOrCreate(
      "game_room",
      { name: "ProductionSmoke" },
      WorldState,
    );
    room.reconnection.enabled = false;
    let info;
    room.onMessage("worldInfo", (message) => {
      info = message;
    });
    room.send("ready", {});
    for (
      let i = 0;
      i < 100 && (!info || !room.state.players.has(room.sessionId));
      i++
    )
      await delay(50);
    assert.equal(info.map.length, 250);
    assert.equal(info.map[0].length, 250);
    assert.equal(
      room.state.players.get(room.sessionId).name,
      "ProductionSmoke",
    );
    assert.ok(room.state.resources.size > 0);
    console.log(
      "Production smoke passed: compiled map, HTTP assets, gzip, cache, private monitor, WebSocket and schema state.",
    );
  } finally {
    if (room) await room.leave();
    await gameServer.gracefullyShutdown(false);
  }
}
void smoke().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
