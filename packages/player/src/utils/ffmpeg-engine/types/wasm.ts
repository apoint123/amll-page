export interface EmbindObject {
	delete(): void;
	isDeleted(): boolean;
}

export interface StringList extends EmbindObject {
	size(): number;
	get(index: number): string;
}

export interface StringMap extends EmbindObject {
	keys(): StringList;
	get(key: string): string;
	set(key: string, value: string): void;
	size(): number;
}

export interface Uint8List extends EmbindObject {
	size(): number;
	get(index: number): number;
}

export interface DecoderStatus {
	status: number;
	error: string;
}

export interface AudioProperties {
	status: DecoderStatus;
	encoding: string;
	sampleRate: number;
	channelCount: number;
	duration: number;
	metadata: StringMap;
	coverArt: Uint8List;
	bitsPerSample: number;
}

export enum SampleFormat {
	PlanarF32 = 0,
	InterleavedS16 = 1,
}

export interface ChunkResult {
	status: DecoderStatus;
	samples: Float32Array | Int16Array;
	isEOF: boolean;
	startTime: number;
}

export interface AudioStreamDecoder extends EmbindObject {
	init(path: string): AudioProperties;
	initStream(
		readCallback: (ptr: number, size: number) => number,
		seekCallback: (offset: number, whence: number) => number,
	): AudioProperties;
	readChunk(chunkSize: number, format?: SampleFormat): ChunkResult;
	seek(timestamp: number): DecoderStatus;
	close(): void;
	setTempo(tempo: number): void;
	setPitch(pitch: number): void;
	delete(): void;
}

export interface AudioDecoderModule extends EmscriptenModule {
	FS: typeof FS & {
		filesystems: {
			WORKERFS: Emscripten.FileSystemType;
		};
	};
	AudioStreamDecoder: {
		new (): AudioStreamDecoder;
	};
	SampleFormat: typeof SampleFormat;
}
