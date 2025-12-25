const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Check if a video file has browser-compatible codecs
 * Returns information about the video codec and whether it needs transcoding
 */
async function checkVideoCodec(filePath) {
    try {
        // Use ffprobe to get codec information
        const { stdout } = await execAsync(
            `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,codec_long_name -of json "${filePath}"`
        );

        const data = JSON.parse(stdout);
        const videoStream = data.streams?.[0];

        if (!videoStream) {
            return {
                compatible: false,
                needsTranscoding: true,
                reason: 'No video stream found',
                codec: 'unknown'
            };
        }

        const codec = videoStream.codec_name;
        const codecLong = videoStream.codec_long_name;

        // List of codecs that browsers typically support
        const browserSupportedCodecs = [
            'h264',      // H.264/AVC
            'vp8',       // VP8
            'vp9',       // VP9
            'av1',       // AV1
            'theora'     // Theora
        ];

        const isCompatible = browserSupportedCodecs.includes(codec.toLowerCase());

        return {
            compatible: isCompatible,
            needsTranscoding: !isCompatible,
            codec: codec,
            codecLong: codecLong,
            reason: isCompatible ? 'Browser-compatible codec' : `Codec ${codec} not browser-compatible`
        };

    } catch (error) {
        console.error('Error checking video codec:', error.message);
        return {
            compatible: false,
            needsTranscoding: true,
            reason: 'Error analyzing video file - may be corrupted',
            codec: 'error',
            error: error.message
        };
    }
}

/**
 * Quick check if ffprobe is available
 */
async function isFFProbeAvailable() {
    try {
        await execAsync('ffprobe -version');
        return true;
    } catch (error) {
        return false;
    }
}

module.exports = {
    checkVideoCodec,
    isFFProbeAvailable
};
