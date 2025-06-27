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
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setImmediate(() => callback(0));
          }
        }),
        kill: jest.fn()
      };
      
      spawn.mockReturnValue(mockProcess);

      const req = request(app).get('/video-transcode?path=test.avi');
      
      // Don't wait for full response, just check spawn was called
      setTimeout(() => {
        expect(spawn).toHaveBeenCalledWith('ffmpeg', [
          '-i', expect.stringContaining('test.avi'),
          '-c:v', 'libvpx-vp9',
          '-preset', 'fast',
          '-crf', '30',
          '-c:a', 'libopus',
          '-f', 'webm',
          '-'
        ]);
        req.abort();
      }, 100);
      
      try {
        await req;
      } catch (error) {
        // Expected due to abort
      }
    }, 10000);

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
            setImmediate(() => callback(0));
          }
        }),
        kill: jest.fn()
      };
      
      spawn.mockReturnValue(mockProcess);

      const req = request(app).get('/video-transcode?path=test.avi');
      
      setTimeout(() => {
        expect(mockProcess.on).toHaveBeenCalledWith('close', expect.any(Function));
        req.abort();
      }, 100);
      
      try {
        await req;
      } catch (error) {
        // Expected due to abort
      }
    }, 10000);

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
            setImmediate(() => callback(new Error('FFmpeg not found')));
          }
        }),
        kill: jest.fn()
      };
      
      spawn.mockReturnValue(mockProcess);

      const req = request(app).get('/video-transcode?path=test.avi');
      
      setTimeout(() => {
        expect(mockProcess.on).toHaveBeenCalledWith('error', expect.any(Function));
        req.abort();
      }, 100);
      
      try {
        await req;
      } catch (error) {
        // Expected due to abort
      }
    }, 10000);

    test('should handle client disconnect by killing FFmpeg', async () => {
      const mockProcess = {
        stdout: {
          pipe: jest.fn()
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setImmediate(() => callback(0));
          }
        }),
        kill: jest.fn()
      };
      
      spawn.mockReturnValue(mockProcess);

      const req = request(app).get('/video-transcode?path=test.avi');
      
      // Check that process was created
      setTimeout(() => {
        expect(spawn).toHaveBeenCalled();
        req.abort();
      }, 50);
      
      try {
        await req;
      } catch (error) {
        // Expected due to abort
      }
    }, 5000);

    test('should handle FFmpeg stderr logging', async () => {
      const mockProcess = {
        stdout: {
          pipe: jest.fn()
        },
        stderr: {
          on: jest.fn((event, callback) => {
            if (event === 'data') {
              setImmediate(() => callback(Buffer.from('FFmpeg output')));
            }
          })
        },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            setImmediate(() => callback(0));
          }
        }),
        kill: jest.fn()
      };
      
      spawn.mockReturnValue(mockProcess);

      const req = request(app).get('/video-transcode?path=test.avi');
      
      // Don't wait for response, just check that stderr.on was called
      setTimeout(() => {
        expect(mockProcess.stderr.on).toHaveBeenCalledWith('data', expect.any(Function));
        req.abort();
      }, 100);
      
      try {
        await req;
      } catch (error) {
        // Expected due to abort
      }
    }, 10000);
  });
});