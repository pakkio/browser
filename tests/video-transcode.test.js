const { planTranscode, buildStreamArgs, streamMime } = require('../lib/video-transcode');

const h264 = { codec_name: 'h264', pix_fmt: 'yuv420p', profile: 'High', level: 41 };
const aac = { codec_name: 'aac', profile: 'LC' };
const probe = (video, audio) => ({ success: true, video, audio });

describe('planTranscode', () => {
  test('rewraps H.264 with AAC-LC or no audio', () => {
    expect(planTranscode(probe(h264, [aac]))).toBe('copy');
    expect(planTranscode(probe(h264, []))).toBe('copy');
  });

  test('keeps the video but converts audio browsers cannot stream', () => {
    for (const audio of [{ codec_name: 'ac3' }, { codec_name: 'dts' }, { codec_name: 'mp3' }, { codec_name: 'aac', profile: 'HE-AAC' }]) {
      expect(planTranscode(probe(h264, [audio]))).toBe('audio');
    }
  });

  test('re-encodes other video codecs, 10-bit and unknown profiles', () => {
    expect(planTranscode(probe({ codec_name: 'mpeg2video', pix_fmt: 'yuv420p' }, [aac]))).toBe('full');
    expect(planTranscode(probe({ codec_name: 'mpeg4', pix_fmt: 'yuv420p' }, [aac]))).toBe('full');
    expect(planTranscode(probe({ ...h264, pix_fmt: 'yuv420p10le' }, [aac]))).toBe('full');
    expect(planTranscode(probe({ ...h264, profile: 'High 10' }, [aac]))).toBe('full');
  });

  test('re-encodes when the file cannot be probed', () => {
    expect(planTranscode({ success: false })).toBe('full');
    expect(planTranscode(null)).toBe('full');
  });
});

describe('buildStreamArgs', () => {
  test('copy mode keeps both streams and writes fragmented MP4 to stdout', () => {
    const args = buildStreamArgs('a.mkv', 'copy');
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'copy', '-c:a', 'copy', '-f', 'mp4']));
    expect(args.join(' ')).toContain('frag_keyframe+empty_moov');
    expect(args[args.length - 1]).toBe('-');
    expect(args).not.toContain('-ss');
  });

  test('audio mode copies video and encodes AAC', () => {
    expect(buildStreamArgs('a.avi', 'audio')).toEqual(expect.arrayContaining(['-c:v', 'copy', '-c:a', 'aac']));
  });

  test('full mode encodes H.264 + AAC', () => {
    expect(buildStreamArgs('a.mpg', 'full')).toEqual(expect.arrayContaining(['libx264', 'ultrafast', 'aac']));
  });

  test('a start time seeks before the input', () => {
    const args = buildStreamArgs('a.mkv', 'copy', 600.5);
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-ss') + 1]).toBe('600.5');
  });
});

describe('streamMime', () => {
  test('describes a rewrapped H.264 stream from its probe', () => {
    expect(streamMime(probe(h264, [aac]), 'copy')).toBe('video/mp4; codecs="avc1.640029, mp4a.40.2"');
    expect(streamMime(probe({ ...h264, profile: 'Main', level: 31 }, []), 'copy')).toBe('video/mp4; codecs="avc1.4d001f"');
  });

  test('re-encoded streams always declare the encoder output', () => {
    expect(streamMime({ success: false }, 'full')).toBe('video/mp4; codecs="avc1.640029, mp4a.40.2"');
  });
});
