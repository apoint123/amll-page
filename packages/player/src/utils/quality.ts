import {
	AudioQualityType,
	type MusicQualityState,
} from "@applemusic-like-lyrics/react-full";
import type { IAudioMetadata } from "music-metadata";

export function mapMetadataToQuality(
	metadata: IAudioMetadata,
): MusicQualityState {
	const { format } = metadata;

	const sampleRate = format.sampleRate || 44100;
	const bitsPerSample = format.bitsPerSample || 16;
	const codec = format.codec || "Unknown";
	const channels = format.numberOfChannels || 2;

	let type = AudioQualityType.Standard;

	if (format.lossless) {
		if (sampleRate > 48000 || bitsPerSample > 24) {
			type = AudioQualityType.HiResLossless;
		} else {
			type = AudioQualityType.Lossless;
		}
	} else {
		type = AudioQualityType.Standard;
	}

	const sampleFormat = bitsPerSample ? `${bitsPerSample}-bit` : "Unknown";

	return {
		type,
		codec,
		channels,
		sampleRate,
		sampleFormat,
	};
}
