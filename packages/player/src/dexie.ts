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
	addTime?: number;
	accessTime?: number;
}

export interface TTMLDBLyricEntry {
	name: string;
	content: TTMLLyric;
	raw: string;
}

export interface AuditMetadataEntry {
	songId: string;
	prId: number;
	prNumber: number;
	prTitle: string;
	prAuthor: string;
	prHeadSha: string;
	platformId?: string;
	candidateIds?: string[];
	status: "pending" | "approved" | "merged" | "closed";
	rawTtmlUrl?: string;
}

export const db = new Dexie("amll-player") as Dexie & {
	playlists: EntityTable<Playlist, "id">;
	songs: EntityTable<Song, "id">;
	ttmlDB: EntityTable<TTMLDBLyricEntry, "name">;
	auditMetadata: EntityTable<AuditMetadataEntry, "songId">;
};

export const AUDIT_PLAYLIST_ID = -999;

db.version(1).stores({
	playlists: "++id,name,createTime,updateTime,playTime",
	songs: "&id,filePath,songName,songArtists",
	ttmlDB: "&name",
	auditMetadata: "&songId, prId, status",
});

db.version(2).stores({
	songs: "&id,filePath,songName,songArtists,accessTime",
});
