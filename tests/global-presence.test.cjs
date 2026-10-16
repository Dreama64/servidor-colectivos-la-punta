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

test('global snapshots: hub registration, channels, rename, same-install replacement, duplicates and disconnect', { timeout: 10000 }, async () => {
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

  const global = client => client.messages.filter(m => m.type === 'lista_usuarios_global').at(-1)?.usuarios;
  const register = (client, nombre, clienteId) => client.send(JSON.stringify({ type: 'registrar_usuario', emisor: nombre, clienteId }));
  try {
    const hub = await connect(); register(hub, 'Central', 'hub');
    await waitFor(() => global(hub)?.length === 1);
    assert.equal(global(hub)[0].sala, null);
    const anonymous = await connect();
    register(anonymous, 'Invalid', '');
    await delay(30); assert.equal(global(hub).length, 1);
    const phone = await connect(); register(phone, 'Juan', 'phone');
    await waitFor(() => global(hub)?.length === 2);
    assert.ok(global(hub).every(u => u.sala === null));
    register(phone, 'Juan', 'phone'); await delay(30); assert.equal(global(hub).length, 2);
    join(phone, 'Juan', 'phone');
    await waitFor(() => global(hub)?.find(u => u.clienteId === 'phone')?.sala === 'General');
    assert.equal(list(phone).length, 1);
    register(phone, 'Juan Renombrado', 'phone');
    await waitFor(() => global(hub)?.some(u => u.nombre === 'Juan Renombrado'));
    assert.equal(global(hub).find(u => u.clienteId === 'phone').sala, 'General');
    const other = await connect(); join(other, 'Juan', 'other');
    await waitFor(() => global(hub)?.length === 3 && list(phone)?.length === 2);
    join(phone, 'Juan', 'phone', 'Canal 1');
    await waitFor(() => global(hub)?.find(u => u.clienteId === 'phone')?.sala === 'Canal 1' && list(other)?.length === 1);
    phone.send(JSON.stringify({ type: 'leave_channel' }));
    await waitFor(() => global(hub)?.find(u => u.clienteId === 'phone')?.sala === null);
    const replacement = await connect(); const closed = once(phone, 'close');
    register(replacement, 'Juan Nuevo', 'phone'); assert.equal((await closed)[0], 4001);
    await waitFor(() => global(hub)?.some(u => u.nombre === 'Juan Nuevo'));
    await delay(30);
    assert.equal(global(hub).length, 3);
    assert.equal(global(hub).filter(u => u.clienteId === 'phone').length, 1);
    assert.equal(global(hub).find(u => u.clienteId === 'phone').sala, null);
    const replacement2 = await connect(); const closed2 = once(other, 'close');
    register(replacement2, 'Juan', 'other'); assert.equal((await closed2)[0], 4001);
    await waitFor(() => global(hub)?.find(u => u.clienteId === 'other')?.sala === null);
    replacement.terminate(); await once(replacement, 'close');
    await waitFor(() => global(hub)?.length === 2);
    assert.ok(!global(hub).some(u => u.clienteId === 'phone'));
    const legacy = await connect(); join(legacy, 'Legacy', undefined);
    await waitFor(() => global(hub)?.length === 3);
    assert.equal(global(hub).find(u => u.nombre === 'Legacy').sala, 'General');
    legacy.close(); await once(legacy, 'close'); await waitFor(() => global(hub)?.length === 2);
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
