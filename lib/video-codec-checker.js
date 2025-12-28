const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Check if ffprobe is available on the system
 * @returns {Promise<boolean>} True if ffprobe is available
 */
async function isFFProbeAvailable() {
    try {
        await execAsync('ffprobe -version');
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Check video codec information using ffprobe
 * Returns comprehensive metadata including browser compatibility
 * @param {string} filePath - Path to the video file
 * @returns {Promise<Object>} Codec information and compatibility status
 */
async function checkVideoCodec(filePath) {
    try {
        // Check if ffprobe is available
        const available = await isFFProbeAvailable();
        if (!available) {
            return {
                success: false,
                compatible: false,
                needsTranscoding: true,
                error: 'ffprobe not available',
                message: 'ffprobe is not installed or not in PATH. Please install ffmpeg to use this feature.'
            };
        }

        // Run ffprobe to get comprehensive codec information
        const { stdout } = await execAsync(
            `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`
        );

        const info = JSON.parse(stdout);

        // Extract video stream information
        const videoStream = info.streams?.find(s => s.codec_type === 'video');
        const audioStreams = info.streams?.filter(s => s.codec_type === 'audio') || [];

        if (!videoStream) {
            return {
                success: false,
                compatible: false,
                needsTranscoding: true,
                error: 'No video stream found',
                message: 'The file does not contain a video stream.',
                codec: 'unknown'
            };
        }

        // List of codecs that browsers typically support
        const browserSupportedCodecs = [
            'h264',      // H.264/AVC
            'vp8',       // VP8
            'vp9',       // VP9
            'av1',       // AV1
            'theora'     // Theora
        ];

        const codecName = videoStream.codec_name?.toLowerCase();
        const isCompatible = browserSupportedCodecs.includes(codecName);

        return {
            success: true,
            compatible: isCompatible,
            needsTranscoding: !isCompatible,
            reason: isCompatible ? 'Browser-compatible codec' : `Codec ${videoStream.codec_name} not browser-compatible`,
            format: {
                filename: info.format?.filename,
                format_name: info.format?.format_name,
                format_long_name: info.format?.format_long_name,
                duration: parseFloat(info.format?.duration) || 0,
                size: parseInt(info.format?.size) || 0,
                bit_rate: parseInt(info.format?.bit_rate) || 0
            },
            video: {
                codec_name: videoStream.codec_name,
                codec_long_name: videoStream.codec_long_name,
                profile: videoStream.profile,
                width: videoStream.width,
                height: videoStream.height,
                aspect_ratio: videoStream.display_aspect_ratio,
                pix_fmt: videoStream.pix_fmt,
                frame_rate: videoStream.r_frame_rate,
                bit_rate: parseInt(videoStream.bit_rate) || 0
            },
            audio: audioStreams.map(stream => ({
                codec_name: stream.codec_name,
                codec_long_name: stream.codec_long_name,
                sample_rate: parseInt(stream.sample_rate) || 0,
                channels: stream.channels,
                bit_rate: parseInt(stream.bit_rate) || 0
            }))
        };
    } catch (error) {
        console.error('Error checking video codec:', error.message);
        return {
            success: false,
            compatible: false,
            needsTranscoding: true,
            error: error.message,
            message: `Failed to analyze video file: ${error.message}`,
            codec: 'error'
        };
    }
}

module.exports = {
    checkVideoCodec,
    isFFProbeAvailable
};
