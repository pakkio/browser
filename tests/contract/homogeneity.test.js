const request = require('supertest');
const app = require('../test-server');

describe('Homogeneity API Contract', () => {
  it('should return a modules array with expected values', async () => {
    const res = await request(app).get('/api/homogeneity');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.modules)).toBe(true);
    expect(res.body.modules).toEqual(expect.arrayContaining(['auth', 'cache', 'file', 'media']));
  });
});
