const NETEASE_API_BASE =
	"https://netease-cloud-music-api-1035942257985.asia-east1.run.app";

export interface NeteaseResponse<T> {
	code: number;
	message?: string;
	msg?: string;
	cookie?: string;
	data?: T;
	[key: string]: unknown;
}

export interface NeteaseProfile {
	userId: number;
	nickname: string;
	avatarUrl: string;
	vipType: number;
	signature?: string;
}

export interface NeteaseSongDetail {
	id: number;
	name: string;
	artists: { id: number; name: string }[];
	album: { id: number; name: string; picUrl: string };
	duration: number;
	fee: number;
	isPlayable: boolean;
	reason?: string;
}

interface RawNeteaseSong {
	id: number;
	name: string;
	ar: { id: number; name: string }[];
	al: { id: number; name: string; picUrl: string };
	dt: number;
	fee: number;
	privilege?: {
		st: number;
		pl: number;
		fee: number;
	};
}

async function request<T>(
	path: string,
	options: {
		params?: Record<string, string | number | boolean>;
		method?: "GET" | "POST";
		cookie?: string;
	} = {},
): Promise<T> {
	const url = new URL(`${NETEASE_API_BASE}${path}`);

	const params: Record<string, string | boolean> = {
		timestamp: Date.now().toString(),
		randomCNIP: true,
		...options.params,
	};

	if (options.cookie) {
		params.cookie = options.cookie;
	}

	Object.keys(params).forEach((key) => {
		url.searchParams.append(key, String(params[key]));
	});

	try {
		const res = await fetch(url.toString(), {
			method: options.method || "GET",
			credentials: "include",
		});

		const data = await res.json();

		const responseCode = data.code ?? data.data?.code;

		if (responseCode !== undefined && responseCode !== 200) {
			throw new Error(data.msg || data.message || `API Error: ${responseCode}`);
		}

		return data as T;
	} catch (error) {
		console.error(`[Netease API] Request failed: ${path}`, error);
		throw error;
	}
}

export const NeteaseClient = {
	auth: {
		sendCaptcha: async (phone: string, ctcode = "86") => {
			return request<NeteaseResponse<boolean>>("/captcha/sent", {
				params: { phone, ctcode },
			});
		},

		loginByPhone: async (phone: string, captcha: string, ctcode = "86") => {
			const res = await request<
				NeteaseResponse<Record<string, unknown>> & {
					profile: NeteaseProfile;
					cookie: string;
				}
			>("/login/cellphone", {
				params: { phone, captcha, ctcode },
			});

			return {
				cookie: res.cookie,
				profile: res.profile,
			};
		},

		checkCookieStatus: async (cookieString: string) => {
			const res = await request<{
				data: {
					profile: NeteaseProfile | null;
					account?: { vipType: number; id: number };
				};
			}>("/login/status", {
				cookie: cookieString,
				method: "POST",
			});

			const profile = res.data?.profile;
			const account = res.data?.account;

			if (profile) {
				if (account && typeof account.vipType === "number") {
					return {
						...profile,
						vipType: account.vipType,
					};
				}
				return profile;
			}
			throw new Error("Cookie 已失效或未登录");
		},
	},

	song: {
		getDetails: async (
			ids: string[],
			cookie?: string,
		): Promise<NeteaseSongDetail[]> => {
			if (ids.length === 0) return [];

			const res = await request<{
				songs: RawNeteaseSong[];
				privileges: { id: number; st: number }[];
			}>("/song/detail", {
				params: { ids: ids.join(",") },
				cookie,
			});

			if (!res.songs || res.songs.length === 0) return [];

			const privilegeMap = new Map(
				(res.privileges || []).map((p) => [p.id, p]),
			);

			return res.songs.map((song) => {
				const priv = privilegeMap.get(song.id) || song.privilege;
				const st = priv?.st ?? 0;

				const isPlayable = st >= 0;

				return {
					id: song.id,
					name: song.name,
					artists: song.ar.map((a) => ({ id: a.id, name: a.name })),
					album: {
						id: song.al.id,
						name: song.al.name,
						picUrl: song.al.picUrl,
					},
					duration: song.dt,
					fee: song.fee,
					isPlayable,
					reason: !isPlayable ? "版权受限或已下架" : undefined,
				};
			});
		},

		getUrl: async (
			id: string,
			level: "standard" | "exhigh" | "lossless" | "hires" = "standard",
			cookie?: string,
		) => {
			const res = await request<{
				data: { url: string; size: number; code: number }[];
			}>("/song/url/v1", {
				params: { id, level },
				cookie,
			});

			const originUrl = res.data?.[0]?.url;

			if (originUrl) {
				return originUrl.replace(/^http:/, "https:");
			}

			return null;
		},
	},
};
