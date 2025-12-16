// biome-ignore lint/suspicious/noExplicitAny: 为了兼容接口类型定义
type EventMap = Record<string, any>;

export class TypedEventTarget<M extends EventMap> extends EventTarget {
	override addEventListener<K extends keyof M & string>(
		type: K,
		listener: (ev: CustomEvent<M[K]>) => void,
		options?: boolean | AddEventListenerOptions,
	): void;
	override addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions,
	): void;
	override addEventListener(
		type: string,
		listener:
			| EventListenerOrEventListenerObject
			| null
			// biome-ignore lint/suspicious/noExplicitAny: 兼容重载
			| ((...args: any[]) => void),
		options?: boolean | AddEventListenerOptions,
	): void {
		super.addEventListener(type, listener, options);
	}

	override removeEventListener<K extends keyof M & string>(
		type: K,
		listener: (ev: CustomEvent<M[K]>) => void,
		options?: boolean | EventListenerOptions,
	): void;
	override removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions,
	): void;
	override removeEventListener(
		type: string,
		listener:
			| EventListenerOrEventListenerObject
			| null
			// biome-ignore lint/suspicious/noExplicitAny: 兼容重载
			| ((...args: any[]) => void),
		options?: boolean | EventListenerOptions,
	): void {
		super.removeEventListener(type, listener, options);
	}

	protected emit<K extends keyof M & string>(
		type: K,
		...args: undefined extends M[K] ? [detail?: M[K]] : [detail: M[K]]
	): boolean {
		const [detail] = args;
		return this.dispatchEvent(new CustomEvent(type, { detail }));
	}
}
