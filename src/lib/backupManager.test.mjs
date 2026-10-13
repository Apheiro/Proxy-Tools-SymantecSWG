import assert from 'node:assert/strict';
import test from 'node:test';
import { displayBackupLine, findBackupAppliance } from './backupManager.ts';

test('preview removes terminal decoration without changing Unicode or key text', () => {
  assert.equal(displayBackupLine('\x1b[32m!- configuración\x1b[0m\r'), '!- configuración');
  assert.equal(displayBackupLine('\x1b]0;Dummy\x07-----END DUMMY PRIVATE KEY-----'), '-----END DUMMY PRIVATE KEY-----');
});

test('appliance labels reuse registered inventory addresses', () => {
  const proxy = { hostname: 'SWG', primary_address: '192.0.2.10', registered_address: 'swg.example', hostinfo: { ip: '192.0.2.10', hostname: 'SWG' } };
  assert.equal(findBackupAppliance([proxy], '192.0.2.10'), proxy);
  assert.equal(findBackupAppliance([proxy], 'swg.example'), proxy);
  assert.equal(findBackupAppliance([proxy], 'other'), undefined);
});
