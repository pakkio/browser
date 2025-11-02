const request = require('supertest');
const app = require('../tests/test-server');
const Orthogonality = require('../src/models/orthogonality');

async function run() {
  let failures = 0;
  const results = [];

  function assert(condition, message) {
    if (!condition) {
      failures++;
      results.push({ status: 'FAIL', message });
    } else {
      results.push({ status: 'PASS', message });
    }
  }

  // Test 1: Homogeneity endpoint
  try {
    const res = await request(app).get('/api/homogeneity');
    assert(res.statusCode === 200, 'GET /api/homogeneity returns 200');
    assert(Array.isArray(res.body.modules), 'Response has modules array');
    const expected = ['auth', 'cache', 'file', 'media'];
    assert(expected.every(m => res.body.modules.includes(m)), 'Modules contain expected values');
  } catch (e) {
    failures++;
    results.push({ status: 'FAIL', message: `GET /api/homogeneity threw: ${e.message}` });
  }

  // Test 2: Orthogonality endpoint
  try {
    const payload = { name: 'A', value: 42 };
    const res = await request(app).post('/api/orthogonality').send(payload);
    assert(res.statusCode === 200, 'POST /api/orthogonality returns 200');
    assert(res.body && res.body.updated && res.body.updated.name === 'A' && res.body.updated.value === 42, 'Orthogonality update returns expected payload');
  } catch (e) {
    failures++;
    results.push({ status: 'FAIL', message: `POST /api/orthogonality threw: ${e.message}` });
  }

  // Test 3: Orthogonality model isolation
  try {
    const model = new Orthogonality({ A: 1, B: 2 });
    model.updateEntity('A', 3);
    assert(model.getEntity('B') === 2, 'Updating A does not affect B');
  } catch (e) {
    failures++;
    results.push({ status: 'FAIL', message: `Orthogonality model error: ${e.message}` });
  }

  // Print summary
  for (const r of results) {
    console.log(`${r.status}: ${r.message}`);
  }
  console.log(`\nSummary: ${results.length - failures} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

run();

