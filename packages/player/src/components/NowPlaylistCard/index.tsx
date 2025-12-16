import { PlayIcon } from "@radix-ui/react-icons";
import { Avatar, Box, Flex, type FlexProps, Inset } from "@radix-ui/themes";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLiveQuery } from "dexie-react-hooks";
import { useAtom, useAtomValue } from "jotai";
import { type CSSProperties, type FC, useEffect, useMemo, useRef } from "react";
import { Trans } from "react-i18next";
import { db } from "../../dexie.ts";
import {
	currentMusicIndexAtom,
	currentMusicQueueAtom,
	onRequestPlaySongByIndexAtom,
} from "../../states/appAtoms.ts";
import styles from "./index.module.css";

const PlaylistSongItem: FC<{
	songId: string;
	index: number;
	style: CSSProperties;
}> = ({ songId, index, style }) => {
	const [currentIndex] = useAtom(currentMusicIndexAtom);
	const playSongByIndex = useAtomValue(onRequestPlaySongByIndexAtom).onEmit;

	const song = useLiveQuery(() => db.songs.get(songId), [songId]);

	const coverUrl = useMemo(() => {
		if (song?.cover instanceof Blob) {
			return URL.createObjectURL(song.cover);
		}
		return "";
	}, [song?.cover]);

	useEffect(() => {
		return () => {
			if (coverUrl) URL.revokeObjectURL(coverUrl);
		};
	}, [coverUrl]);

	const name = song?.songName ?? "未知歌曲";
	const artists = song?.songArtists ?? "未知艺术家";
	const isPlaying = currentIndex === index;

	return (
		<div style={style} className={styles.playlistSongItemWrapper}>
			<button
				type="button"
				className={styles.playlistSongItem}
				onDoubleClick={() => playSongByIndex(index)}
				aria-label={`播放 ${name} - ${artists}`}
				data-active={isPlaying}
			>
				<Avatar size="4" fallback={<div />} src={coverUrl} />
				<div className={styles.musicInfo}>
					<div className={styles.name}>{name}</div>
					<div className={styles.artists}>{artists}</div>
				</div>
				{isPlaying && <PlayIcon />}
			</button>
		</div>
	);
};

export const NowPlaylistCard: FC<FlexProps> = (props) => {
	const playlist = useAtomValue(currentMusicQueueAtom);
	const playlistIndex = useAtomValue(currentMusicIndexAtom);
	const playlistContainerRef = useRef<HTMLDivElement>(null);

	const rowVirtualizer = useVirtualizer({
		count: playlist.length,
		getScrollElement: () => playlistContainerRef.current,
		estimateSize: () => 55,
		overscan: 5,
	});

	useEffect(() => {
		if (rowVirtualizer && playlistIndex >= 0) {
			rowVirtualizer.scrollToIndex(playlistIndex, { align: "center" });
		}
	}, [playlistIndex, rowVirtualizer]);

	return (
		<Flex
			direction="column"
			maxWidth="400px"
			maxHeight="500px"
			style={{
				height: "50vh",
				width: "max(10vw, 50vh)",
				backdropFilter: "blur(1em)",
				backgroundColor: "var(--black-a8)",
			}}
			{...props}
		>
			<Box py="3" px="4">
				<Trans i18nKey="playbar.playlist.title">当前播放列表</Trans>
			</Box>
			<Inset
				clip="padding-box"
				side="bottom"
				pb="current"
				style={{ overflowY: "auto" }}
				ref={playlistContainerRef}
			>
				<div
					style={{
						height: `${rowVirtualizer.getTotalSize()}px`,
						width: "100%",
						position: "relative",
					}}
				>
					{rowVirtualizer.getVirtualItems().map((virtualItem) => {
						const songId = playlist[virtualItem.index];
						return (
							<PlaylistSongItem
								key={virtualItem.key}
								style={{
									position: "absolute",
									top: 0,
									left: 0,
									width: "100%",
									height: `${virtualItem.size}px`,
									transform: `translateY(${virtualItem.start}px)`,
								}}
								songId={songId}
								index={virtualItem.index}
							/>
						);
					})}
				</div>
			</Inset>
		</Flex>
	);
};
