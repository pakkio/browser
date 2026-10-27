const request = require('supertest');
const path = require('path');

const SRV = path.resolve(__dirname, '..', 'server.js');
const AUTH = path.resolve(__dirname, '..', 'auth.js');
const CFG = path.resolve(__dirname, '..', 'lib', 'config.js');
const ROUTES = path.resolve(__dirname, '..', 'lib', 'auth-routes.js');

function cleanServerLoad() {
  jest.resetModules();
  // jest.resetModules may keep core modules, ensure our modules are fresh
  return require('../server.js');
}

describe('AUTH=TRUE (Authentication Enabled)', () => {
  let app;

  beforeAll(() => {
    process.env.AUTH = 'TRUE';
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    app = cleanServerLoad();
  });

  afterAll(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  test('should redirect to Google OAuth on /auth/google', async () => {
    const response = await request(app)
      .get('/auth/google')
      .expect(302);

    expect(response.headers.location).toContain('accounts.google.com');
  });

  test('should redirect unauthenticated requests to Google OAuth', async () => {
    const response = await request(app)
      .get('/api/browse')
      .expect(401);

    expect(response.body.error).toBe('Authentication required');
    expect(response.body.loginUrl).toBe('/auth/google');
  });

  test('should return login failed page', async () => {
    const response = await request(app)
      .get('/login-failed')
      .expect(401);

    expect(response.text).toContain('Authentication Failed');
    expect(response.text).toContain('Try Again');
  });

  test('should return auth status when not authenticated', async () => {
    const response = await request(app)
      .get('/auth/user')
      .expect(200);

    expect(response.body.authenticated).toBe(false);
    expect(response.body.authDisabled).toBeUndefined();
  });
});

describe('AUTH=FALSE (Authentication Disabled)', () => {
  let app;

  beforeAll(() => {
    process.env.AUTH = 'FALSE';
    app = cleanServerLoad();
  });

  test('should allow access to protected routes without auth', async () => {
    const fs = require('fs');
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
      { name: 'test.txt', isDirectory: () => false }
    ]);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({
      size: 1024,
      mtime: new Date('2023-01-01'),
      isDirectory: () => false
    });

    const response = await request(app)
      .get('/api/browse')
      .expect(200);

    expect(response.body).toHaveProperty('files');
  });

  test('should return auth disabled status', async () => {
    const response = await request(app)
      .get('/auth/user')
      .expect(200);

    expect(response.body.authenticated).toBe(false);
    expect(response.body.authDisabled).toBe(true);
  });

  test('should not have auth routes when disabled', async () => {
    await request(app)
      .get('/auth/google')
      .expect(404);
  });

  test('should not have logout route when disabled', async () => {
    await request(app)
      .post('/auth/logout')
      .expect(404);
  });
});

describe('AUTH Environment Variable Variations', () => {
  test.each([
    'TRUE', 'true', 'YES', 'yes', '1'
  ])('should enable auth for AUTH=%s', async (authValue) => {
    process.env.AUTH = authValue;
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    const app = cleanServerLoad();

    const response = await request(app)
      .get('/api/browse');

    expect(response.status).toBe(401);
  });

  test.each([
    'FALSE', 'false', 'NO', 'no', '0', '', 'invalid'
  ])('should disable auth for AUTH=%s', async (authValue) => {
    process.env.AUTH = authValue;
    const app = cleanServerLoad();

    await request(app)
      .get('/api/browse')
      .expect(200);
  });
});
