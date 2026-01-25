export type PlayerState =
	| "idle"
	| "loading"
	| "ready"
	| "playing"
	| "paused"
	| "error";

export interface AudioMetadata {
	sampleRate: number;
	channels: number;
	duration: number;
	metadata: Record<string, string>;
	encoding: string;
	coverUrl?: string | undefined;
	bitsPerSample: number;
}

export interface PlayerEventMap {
	loadstart: undefined;
	loadedmetadata: undefined;
	canplay: undefined;
	play: undefined;
	playing: undefined;
	pause: undefined;
	waiting: undefined;
	seeking: undefined;
	seeked: undefined;
	timeupdate: number;
	volumechange: number;
	durationchange: number;
	ended: undefined;
	sourcedownloaded: Blob;
	error: string;
	emptied: undefined;
}

export type WorkerRequest =
	| { type: "INIT"; id: number; file: File; chunkSize: number }
	| {
			type: "INIT_STREAM";
			id: number;
			fileSize: number;
			sab: SharedArrayBuffer;
			chunkSize: number;
	  }
	| { type: "PAUSE"; id: number }
	| { type: "RESUME"; id: number }
	| { type: "SEEK"; id: number; seekTime: number }
	| { type: "SET_TEMPO"; id: number; value: number }
	| { type: "SET_PITCH"; id: number; value: number }
	| { type: "EXPORT_WAV"; id: number; file: File };

export type WorkerResponse =
	| { type: "ERROR"; id: number; error: string }
	| { type: "ACK"; id: number }
	| {
			type: "METADATA";
			id: number;
			sampleRate: number;
			channels: number;
			duration: number;
			metadata: Record<string, string>;
			encoding: string;
			coverUrl?: string | undefined;
			bitsPerSample: number;
	  }
	| {
			type: "CHUNK";
			id: number;
			data: Float32Array;
			startTime: number;
	  }
	| { type: "EOF"; id: number }
	| { type: "SEEK_DONE"; id: number; time: number }
	| { type: "SEEK_NET"; id: number; seekOffset: number }
	| { type: "EXPORT_WAV_DONE"; id: number; blob: Blob };
