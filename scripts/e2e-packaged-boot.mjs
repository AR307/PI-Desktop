import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const executable = process.argv[2];
if (!executable) throw new Error('Usage: node scripts/e2e-packaged-boot.mjs <packaged executable>');
const profile = await mkdtemp(join(tmpdir(), 'pi-desktop-boot-'));
const env = { ...process.env, PI_DESKTOP_DATA_DIR: profile,
  PI_DESKTOP_BOOT_PROBE: '1', PI_DESKTOP_START_MAXIMIZED: '1', ELECTRON_RENDERER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PI_DESKTOP_HOST_BIN;
const child = spawn(resolve(executable), ['--user-data-dir='+join(profile, 'electron')],
  { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let output = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk.toString(); });
const timeout = setTimeout(() => child.kill(), 90_000);
try {
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done); });
  await writeFile(join(profile, 'boot.log'), output);
  assert.equal(code, 0, output.slice(-4000));
  const line = output.split(/\r?\n/).find(line => line.startsWith('BOOT_PROBE '));
  assert.ok(line, 'Packaged application must report its preload and Host boot probe');
  const probe = JSON.parse(line.slice('BOOT_PROBE '.length));
  assert.equal(probe.ok, true, JSON.stringify(probe));
  assert.equal(probe.appName, 'PI-Desktop');
  assert.equal(probe.platform, process.platform);
  assert.ok(probe.hostProtocol, 'Packaged native Host responds');
  assert.equal(probe.ctrlRBlocked, true);
  assert.equal(probe.sessionList?.complete, true);
  assert.equal(probe.sessionList?.capabilitiesConsistent, true);
  assert.ok(probe.sessionList?.returnedCount >= 800);
  assert.ok(process.platform === 'darwin' ? probe.menuCount >= 6 : probe.menuCount === 0);
  console.log(JSON.stringify({ result: 'PASS', version: probe.version, platform: probe.platform,
    hostProtocol: probe.hostProtocol, sessions: probe.sessionList.returnedCount, evidence: profile }));
} finally {
  clearTimeout(timeout);
  console.log('Isolated package evidence retained: '+profile);
}
