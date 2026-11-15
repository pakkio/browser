const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const COPYABLE_PIX_FMTS = ['yuv420p', 'yuvj420p'];

// H.264 profile name (ffprobe) -> profile_idc / constraint flags in an avc1 codec string
const AVC_PROFILES = {
    'Baseline': '42',
    'Constrained Baseline': '42',
    'Main': '4d',
    'Extended': '58',
    'High': '64'
};

/**
 * Decide how much work ffmpeg has to do for a file, from checkVideoCodec() output.
 *  - copy:  H.264 + AAC-LC (or silent): rewrap into fragmented MP4, no re-encoding
 *  - audio: H.264 with other audio (AC3, DTS, MP3, HE-AAC...): copy the video, encode the audio to AAC
 *  - full:  anything else (or unknown): re-encode to H.264/AAC
 */
function planTranscode(info) {
    if (!info || !info.success || !info.video) return 'full';
    const video = info.video;
    const h264 = String(video.codec_name || '').toLowerCase() === 'h264'
        && COPYABLE_PIX_FMTS.includes(video.pix_fmt)
        && AVC_PROFILES[video.profile] !== undefined;
    if (!h264) return 'full';
    const audio = info.audio && info.audio[0];
    if (!audio) return 'copy';
    const lc = String(audio.codec_name || '').toLowerCase() === 'aac' && audio.profile === 'LC';
    return lc ? 'copy' : 'audio';
}

/** MSE type string of what buildStreamArgs() produces for this plan. */
function streamMime(info, mode) {
    let video = 'avc1.640029'; // libx264 output: High profile, level 4.1
    if (mode !== 'full') {
        const profile = AVC_PROFILES[info.video.profile];
        const level = Math.max(0, Math.min(255, parseInt(info.video.level, 10) || 40));
        video = `avc1.${profile}00${level.toString(16).padStart(2, '0')}`;
    }
    const codecs = (info && info.audio && info.audio.length) || mode === 'full' ? `${video}, mp4a.40.2` : video;
    return `video/mp4; codecs="${codecs}"`;
}

/**
 * ffmpeg arguments that write fragmented MP4 to stdout, starting at `start` seconds. The muxer
 * zero-bases every stream, so the player has to add `start` back (see findStartPoint).
 */
function buildStreamArgs(filePath, mode, start = 0) {
    const seek = start > 0 ? ['-ss', String(start)] : [];
    const video = mode === 'full'
        ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
            '-profile:v', 'high', '-level', '4.1', '-g', '48']
        : ['-c:v', 'copy'];
    const audio = mode === 'copy' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k', '-ac', '2'];
    return [
        '-fflags', '+genpts',
        ...seek,
        '-i', filePath,
        '-map', '0:v:0', '-map', '0:a:0?', '-sn',
        ...video,
        ...audio,
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4',
        '-'
    ];
}

/** DTS (seconds) of the first video packet ffmpeg reads when seeking to `time`, or null. */
async function firstDts(filePath, time) {
    const { stdout } = await execFileAsync('ffmpeg', [
        '-v', 'error',
        ...(time > 0 ? ['-ss', String(time)] : []),
        '-i', filePath,
        '-map', '0:v:0', '-c', 'copy', '-frames:v', '1',
        '-copyts', '-f', 'framecrc', '-'
    ], { timeout: 15000 });
    const base = /^#tb 0: (\d+)\/(\d+)/m.exec(stdout);
    const packet = /^0,\s*(-?\d+),/m.exec(stdout);
    if (!base || !packet) return null;
    return Number(packet[1]) * Number(base[1]) / Number(base[2]);
}

/**
 * Where a stream asked to begin at `time` really starts, in seconds from the beginning of the movie.
 * A rewrap can only begin on a keyframe; a re-encode is exact. The muxer zero-bases the stream, so
 * the player needs this to place it on its timeline. Asking ffmpeg itself (rather than probing for
 * keyframes) guarantees the answer matches the seek it will really do.
 */
async function findStartPoint(filePath, mode, time) {
    if (!(time > 0)) return 0;
    if (mode === 'full') return time;
    try {
        const [at, origin] = await Promise.all([firstDts(filePath, time), firstDts(filePath, 0)]);
        if (at !== null && origin !== null) return Math.max(0, Math.min(time, at - origin));
    } catch {
        // fall through: assume the stream starts where it was asked to
    }
    return time;
}

module.exports = {
    findStartPoint,
    planTranscode,
    streamMime,
    buildStreamArgs
};
