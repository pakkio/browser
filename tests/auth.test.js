const request = require('supertest');

describe('Authentication Tests', () => {
  let originalAuthEnv;
  let originalArgv;
  
  beforeEach(() => {
    originalAuthEnv = process.env.AUTH;
    originalArgv = process.argv;
    // Mock argv to use current directory instead of test file path
    process.argv = ['node', 'server.js', '.'];
    // Clear require cache to force re-import of server with new AUTH setting
    delete require.cache[require.resolve('../server.js')];
    delete require.cache[require.resolve('../auth.js')];
  });
  
  afterEach(() => {
    process.env.AUTH = originalAuthEnv;
    process.argv = originalArgv;
    delete require.cache[require.resolve('../server.js')];
    delete require.cache[require.resolve('../auth.js')];
  });

  describe('AUTH=TRUE (Authentication Enabled)', () => {
    let app;
    
    beforeEach(() => {
      process.env.AUTH = 'TRUE';
      app = require('../server.js');
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
    
    beforeEach(() => {
      process.env.AUTH = 'FALSE';
      app = require('../server.js');
    });

    test('should allow access to protected routes without auth', async () => {
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
    ])('should enable auth for AUTH=%s', (authValue) => {
      process.env.AUTH = authValue;
      const app = require('../server.js');
      
      return request(app)
        .get('/api/browse')
        .expect(401);
    });

    test.each([
      'FALSE', 'false', 'NO', 'no', '0', '', 'invalid'
    ])('should disable auth for AUTH=%s', (authValue) => {
      process.env.AUTH = authValue;
      const app = require('../server.js');
      
      return request(app)
        .get('/api/browse')
        .expect(200);
    });
  });
});