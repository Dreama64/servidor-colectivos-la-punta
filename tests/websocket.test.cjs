const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const http = require('http');
const { once } = require('events');
const WebSocket = require('ws');
const os = require('os');
const { createRequire } = require('module');

test('real WebSockets: presence, replacement, channel changes, leave and chat', { timeout: 10000 }, async () => {
  const file = path.join(__dirname, '../server.js');
  const source = fs.readFileSync(file, 'utf8');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'colectivos-ws-test-'));
  const localRequire = createRequire(file);
  const { server, wss } = vm.runInNewContext(source + '\n;({server, wss})', {
    require: name => name === 'resend' ? { Resend: class {} } : localRequire(name),
    __dirname: temp, process: { env: { PORT: '0' } },
    setInterval, clearInterval, setTimeout, console: { log() {}, error() {} }
  });
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function connect() {
    const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
    client.messages = [];
    client.on('message', message => client.messages.push(JSON.parse(message)));
    clients.push(client); await once(client, 'open'); return client;
  }
  async function waitFor(predicate) {
    for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(10); }
    assert.fail('Timed out waiting for presence');
  }
  const list = client => client.messages.filter(m => m.type === 'lista_usuarios').at(-1)?.usuarios;
  const join = (client, nombre, clienteId, sala = 'General') => client.send(JSON.stringify({ type: 'join_channel', emisor: nombre, clienteId, sala }));
  try {
    const juan = await connect(), andres = await connect();
    join(juan, 'Juan Soto', 'phone-juan'); join(andres, 'Andrés Cruz', 'phone-andres');
    await waitFor(() => list(juan)?.length === 2 && list(andres)?.length === 2);
    join(juan, 'Juan Soto', 'phone-juan');
    await delay(30); assert.equal(list(andres).length, 2, 'repeated join is idempotent');

    const juanNuevo = await connect();
    const closed = once(juan, 'close');
    join(juanNuevo, 'Juan Soto', 'phone-juan');
    const [code] = await closed; assert.equal(code, 4001);
    await waitFor(() => list(juanNuevo)?.length === 2 && list(andres)?.length === 2);
    assert.equal(wss.clients.size, 2, 'old connection really closed, not hidden in UI');

    const sameName = await connect(); join(sameName, 'Juan Soto', 'another-phone');
    await waitFor(() => list(andres)?.length === 3);
    assert.equal(sameName.readyState, WebSocket.OPEN, 'same name does not evict another phone');
    sameName.close(); await once(sameName, 'close');
    await waitFor(() => list(andres)?.length === 2);

    join(juanNuevo, 'Juan Renombrado', 'phone-juan', 'Canal 1');
    await waitFor(() => list(andres)?.length === 1 && list(juanNuevo)?.[0]?.nombre === 'Juan Renombrado');
    assert.equal(list(juanNuevo).length, 1);
    const andresNuevo = await connect(); const andresClosed = once(andres, 'close');
    join(andresNuevo, 'Andrés Cruz', 'phone-andres', 'Canal 1'); await andresClosed;
    await waitFor(() => list(juanNuevo)?.length === 2 && list(andresNuevo)?.length === 2);

    andresNuevo.send(JSON.stringify({ type: 'nuevo_mensaje_texto', sala: 'Canal 1', emisor: 'Andrés Cruz', texto: 'prueba', id: 'one' }));
    await waitFor(() => juanNuevo.messages.some(m => m.id === 'one'));
    assert.equal(juanNuevo.messages.filter(m => m.id === 'one').length, 1);
    const audio = new FormData();
    audio.set('emisor', 'Andrés Cruz'); audio.set('sala', 'Canal 1');
    audio.set('audio', new Blob(['test-audio'], { type: 'audio/mp4' }), 'prueba.m4a');
    assert.equal((await fetch(baseUrl + '/upload', { method: 'POST', body: audio })).status, 200);
    await waitFor(() => juanNuevo.messages.some(m => m.type === 'nuevo_audio'));
    assert.equal(juanNuevo.messages.filter(m => m.type === 'nuevo_audio').length, 1);
    andresNuevo.send(JSON.stringify({ type: 'leave_channel' }));
    await waitFor(() => list(juanNuevo)?.length === 1);
    const before = andresNuevo.messages.length;
    juanNuevo.send(JSON.stringify({ type: 'nuevo_mensaje_texto', sala: 'Canal 1', texto: 'fuera', id: 'two' }));
    await delay(30); assert.equal(andresNuevo.messages.length, before);
    const nextAudio = new FormData();
    nextAudio.set('emisor', 'Juan Renombrado'); nextAudio.set('sala', 'Canal 1');
    nextAudio.set('audio', new Blob(['test-audio']), 'prueba.m4a');
    assert.equal((await fetch(baseUrl + '/upload', { method: 'POST', body: nextAudio })).status, 200);
    await delay(30); assert.equal(andresNuevo.messages.length, before, 'left channel receives no audio');
    join(andresNuevo, 'Andrés Cruz', 'phone-andres', 'Canal 1');
    await waitFor(() => list(juanNuevo)?.length === 2);
    juanNuevo.close(); await once(juanNuevo, 'close'); await waitFor(() => list(andresNuevo)?.length === 1);

    const legacy = await connect(); join(legacy, 'Andrés Cruz', undefined, 'Canal 1');
    await waitFor(() => list(andresNuevo)?.length === 2);
    assert.equal(andresNuevo.readyState, WebSocket.OPEN, 'legacy client remains compatible');
    const report = new FormData(); report.set('author', 'Prueba local'); report.set('description', 'Sin correo externo');
    assert.equal((await fetch(baseUrl + '/report', { method: 'POST', body: report })).status, 200);
  } finally {
    clients.forEach(client => client.terminate());
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(temp);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('colectivos-ws-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
