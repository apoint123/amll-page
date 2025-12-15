import type { TTMLLyric } from "@applemusic-like-lyrics/lyric";
import type { EntityTable } from "dexie";
import Dexie from "dexie";

export interface Playlist {
	id: number;
	name: string;
	playlistCover?: Blob;
	createTime: number;
	updateTime: number;
	playTime: number;
	songIds: string[];
}

export interface Song {
	id: string;
	filePath: string;
	songName: string;
	songArtists: string;
	songAlbum: string;
	cover: Blob;
	file: Blob;
	cachedThumbnail?: Blob;
	duration: number;
	lyricFormat: string;
	lyric: string;
	translatedLrc?: string;
	romanLrc?: string;
}

export interface TTMLDBLyricEntry {
	name: string;
	content: TTMLLyric;
	raw: string;
}

export const db = new Dexie("amll-player") as Dexie & {
	playlists: EntityTable<Playlist, "id">;
	songs: EntityTable<Song, "id">;
	ttmlDB: EntityTable<TTMLDBLyricEntry, "name">;
};

db.version(1).stores({
	playlists: "++id,name,createTime,updateTime,playTime",
	songs: "&id,filePath,songName,songArtists",
	ttmlDB: "&name",
});
