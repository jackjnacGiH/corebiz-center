// Test suites use synthetic database/provider adapters. Fail closed if a test
// accidentally reaches a real provider, database or paid model.
const blocked = () => { throw new Error('TEST_LIVE_NETWORK_BLOCKED'); };
globalThis.fetch = blocked;
for (const name of ['node:http', 'node:https']) {
  const module = require(name);
  module.request = blocked;
  module.get = blocked;
}
const net = require('node:net');
net.connect = blocked;
net.createConnection = blocked;
net.Socket.prototype.connect = blocked;
