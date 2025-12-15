type Listener = (...args: any[]) => void;

export class WebPlayer {
	private events: Record<string, Listener[]> = {};
	private audioContext: AudioContext;
	private audioBuffer: AudioBuffer | null = null;
	private sourceNode: AudioBufferSourceNode | null = null;
	private gainNode: GainNode;
	private isPlaying = false;
	private startTime = 0;
	private pausedTime = 0;

	constructor() {
		this.audioContext = new AudioContext();
		this.gainNode = this.audioContext.createGain();
		this.gainNode.connect(this.audioContext.destination);
	}

	async load(audioFile: File) {
		const arrayBuffer = await audioFile.arrayBuffer();
		this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
		this.emit("loaded");
	}

	play() {
		if (this.isPlaying || !this.audioBuffer) {
			return;
		}

		this.sourceNode = this.audioContext.createBufferSource();
		this.sourceNode.buffer = this.audioBuffer;
		this.sourceNode.connect(this.gainNode);

		const offset = this.pausedTime;
		this.sourceNode.start(0, offset);

		this.startTime = this.audioContext.currentTime - offset;
		this.pausedTime = 0;
		this.isPlaying = true;
		this.emit("play");
	}

	pause() {
		if (!this.isPlaying || !this.sourceNode) {
			return;
		}

		this.sourceNode.stop();
		this.pausedTime = this.audioContext.currentTime - this.startTime;
		this.isPlaying = false;
		this.emit("pause");
	}

	seek(time: number) {
		if (!this.audioBuffer) return;

		const wasPlaying = this.isPlaying;
		if (wasPlaying) {
			this.pause();
		}

		this.pausedTime = time;

		if (wasPlaying) {
			this.play();
		}
	}

	setVolume(volume: number) {
		this.gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
		this.emit("volumechange", volume);
	}

	get duration() {
		return this.audioBuffer?.duration ?? 0;
	}

	get currentTime() {
		if (this.isPlaying) {
			return this.audioContext.currentTime - this.startTime;
		}
		return this.pausedTime;
	}

	on(event: string, listener: Listener) {
		if (!this.events[event]) {
			this.events[event] = [];
		}
		this.events[event].push(listener);
	}

	off(event: string, listener: Listener) {
		if (!this.events[event]) {
			return;
		}
		this.events[event] = this.events[event].filter((l) => l !== listener);
	}

	private emit(event: string, ...args: any[]) {
		if (!this.events[event]) {
			return;
		}
		this.events[event].forEach((listener) => listener(...args));
	}
}
export const webPlayer = new WebPlayer();
