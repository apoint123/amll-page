import { TypedEventTarget } from "./TypedEventTarget";

export interface WebPlayerEventMap {
	play: undefined;
	pause: undefined;
	ended: undefined;
	loaded: undefined;
	timeupdate: number;
	volumechange: number;
	error: Error;
}

export class WebPlayer extends TypedEventTarget<WebPlayerEventMap> {
	private audioContext: AudioContext;
	private audioElement: HTMLAudioElement;
	private sourceNode: MediaElementAudioSourceNode;
	private gainNode: GainNode;
	private currentObjectUrl: string | null = null;

	constructor() {
		super();
		this.audioContext = new AudioContext();
		this.audioElement = new Audio();
		this.audioElement.crossOrigin = "anonymous";

		this.sourceNode = this.audioContext.createMediaElementSource(
			this.audioElement,
		);
		this.gainNode = this.audioContext.createGain();

		this.sourceNode.connect(this.gainNode);
		this.gainNode.connect(this.audioContext.destination);

		this.bindEvents();
	}

	private bindEvents() {
		const simpleEvents = ["play", "pause", "ended"] as const;
		simpleEvents.forEach((evt) => {
			this.audioElement.addEventListener(evt, () => {
				this.emit(evt, undefined);
			});
		});

		this.audioElement.addEventListener("timeupdate", () => {
			this.emit("timeupdate", this.currentTime);
		});

		this.audioElement.addEventListener("error", (e) => {
			console.error("WebPlayer Error:", e);
			const errorMsg =
				this.audioElement.error?.message || "Unknown Audio Error";
			this.emit("error", new Error(errorMsg));
		});
	}

	async load(audioFile: File) {
		if (this.currentObjectUrl) {
			URL.revokeObjectURL(this.currentObjectUrl);
		}

		this.currentObjectUrl = URL.createObjectURL(audioFile);
		this.audioElement.src = this.currentObjectUrl;

		return new Promise<void>((resolve, reject) => {
			const onCanPlay = () => {
				cleanup();
				this.emit("loaded", undefined);
				resolve();
			};
			const onError = (e: Event) => {
				cleanup();
				reject(e);
			};
			const cleanup = () => {
				this.audioElement.removeEventListener("canplay", onCanPlay);
				this.audioElement.removeEventListener("error", onError);
			};

			this.audioElement.addEventListener("canplay", onCanPlay);
			this.audioElement.addEventListener("error", onError);

			this.audioElement.load();
		});
	}

	async play() {
		if (this.audioContext.state === "suspended") {
			await this.audioContext.resume();
		}
		try {
			await this.audioElement.play();
		} catch (err) {
			console.error(err);
		}
	}

	pause() {
		this.audioElement.pause();
	}

	seek(time: number) {
		if (Number.isFinite(time)) {
			this.audioElement.currentTime = time;
		}
	}

	setVolume(volume: number) {
		this.gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
		this.emit("volumechange", volume);
	}

	get duration() {
		return Number.isNaN(this.audioElement.duration)
			? 0
			: this.audioElement.duration;
	}

	get currentTime() {
		return this.audioElement.currentTime;
	}

	getInternalSourceNode() {
		return this.sourceNode;
	}

	getInternalContext() {
		return this.audioContext;
	}
}

export const webPlayer = new WebPlayer();
