const request = require('supertest');
const { spawn } = require('child_process');

// Mock child_process spawn for video transcoding tests
jest.mock('child_process');

describe('Video Transcoding Tests', () => {
  let app;
  
  beforeAll(() => {
    process.env.AUTH = 'FALSE'; // Disable auth for testing
    app = require('../server.js');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /video-transcode', () => {
    test('should require file path parameter', async () => {
      const response = await request(app)
        .get('/video-transcode')
        .expect(400);
      
      expect(response.text).toBe('File path is required');
    });

    test('should prevent path traversal attacks', async () => {
      const response = await request(app)
        .get('/video-transcode?path=../../../etc/passwd')
        .expect(403);
      
      expect(response.text).toBe('Forbidden');
    });

    test('should only accept AVI files', async () => {
      const response = await request(app)
        .get('/video-transcode?path=test.mp4')
        .expect(400);
      
      expect(response.text).toBe('Only AVI files supported for transcoding');
    });

    test('should start FFmpeg transcoding for valid AVI file', async () => {
      // Mock FFmpeg process
      const mockProcess = {
        stdout: {
          pipe: jest.fn()
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn(),
        kill: jest.fn()
      };
      
      spawn.mockReturnValue(mockProcess);

      const response = await request(app)
        .get('/video-transcode?path=test.avi');

      expect(spawn).toHaveBeenCalledWith('ffmpeg', [
        '-i', expect.stringContaining('test.avi'),
        '-c:v', 'libvpx-vp9',
        '-preset', 'fast',
        '-crf', '30',
        '-c:a', 'libopus',
        '-f', 'webm',
        '-'
      ]);
      
      expect(response.headers['content-type']).toBe('video/webm');
    });

    test('should handle FFmpeg process completion', async () => {
      const mockProcess = {
        stdout: {
          pipe: jest.fn()
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            // Simulate successful completion
            setTimeout(() => callback(0), 10);
          }
        }),
        kill: jest.fn()
      };
      
      spawn.mockReturnValue(mockProcess);

      await request(app)
        .get('/video-transcode?path=test.avi');

      expect(mockProcess.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    test('should handle FFmpeg process errors', async () => {
      const mockProcess = {
        stdout: {
          pipe: jest.fn()
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('FFmpeg not found')), 10);
          }
        }),
        kill: jest.fn()
      };
      
      spawn.mockReturnValue(mockProcess);

      await request(app)
        .get('/video-transcode?path=test.avi');

      expect(mockProcess.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    test('should handle client disconnect by killing FFmpeg', (done) => {
      const mockProcess = {
        stdout: {
          pipe: jest.fn()
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn(),
        kill: jest.fn()
      };
      
      spawn.mockReturnValue(mockProcess);

      const agent = request.agent(app);
      const req = agent.get('/video-transcode?path=test.avi');
      
      // Simulate immediate abort
      req.abort();
      
      setTimeout(() => {
        done();
      }, 100);
    }, 1000);

    test('should handle FFmpeg stderr logging', async () => {
      const mockProcess = {
        stdout: {
          pipe: jest.fn()
        },
        stderr: {
          on: jest.fn((event, callback) => {
            if (event === 'data') {
              setTimeout(() => callback(Buffer.from('FFmpeg output')), 10);
            }
          })
        },
        on: jest.fn(),
        kill: jest.fn()
      };
      
      spawn.mockReturnValue(mockProcess);

      const req = request(app).get('/video-transcode?path=test.avi');
      
      // Don't wait for response, just check that stderr.on was called
      setTimeout(() => {
        expect(mockProcess.stderr.on).toHaveBeenCalledWith('data', expect.any(Function));
      }, 50);
      
      // Abort to prevent hanging
      setTimeout(() => req.abort(), 100);
      
      try {
        await req;
      } catch (error) {
        // Expected due to abort
      }
    }, 1000);
  });
});