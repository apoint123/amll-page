import { toDuration } from "@applemusic-like-lyrics/react-full";
import { Avatar, Box, Card, ContextMenu, Flex, Text } from "@radix-ui/themes";
import { type CSSProperties, forwardRef, type PropsWithChildren } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { Song } from "../../dexie.ts";
import { router } from "../../router.tsx";
import { audioPlayer } from "../../utils/ffmpeg-engine/FFmpegAudioPlayer.ts";
import { useSongCover } from "../../utils/use-song-cover.ts";

export const SongCard = forwardRef<
	HTMLDivElement,
	PropsWithChildren<{
		song: Song;
		style?: CSSProperties;
	}>
>(({ song, style, children }, ref) => {
	const songImgUrl = useSongCover(song);
	const { t } = useTranslation();

	return (
		<Box py="1" style={style} ref={ref}>
			<ContextMenu.Root>
				<ContextMenu.Trigger>
					<Card onClick={() => {}}>
						<Flex p="1" align="center" gap="4">
							<Avatar size="5" fallback={<div />} src={songImgUrl} />
							<Flex
								direction="column"
								justify="center"
								flexGrow="1"
								minWidth="0"
							>
								<Text wrap="nowrap" truncate>
									{song.songName ||
										song.filePath ||
										t(
											"page.playlist.music.unknownSongName",
											"未知歌曲 ID {id}",
											{
												id: song.id,
											},
										)}
								</Text>
								<Text wrap="nowrap" truncate color="gray">
									{song.songArtists || ""}
								</Text>
							</Flex>
							<Text wrap="nowrap">
								{song.duration ? toDuration(song.duration) : ""}
							</Text>
							{children}
						</Flex>
					</Card>
				</ContextMenu.Trigger>
				<ContextMenu.Content>
					<ContextMenu.Item
						onClick={async () => {
							if (song.file instanceof Blob) {
								const file = new File([song.file], song.filePath, {
									type: song.file.type,
								});
								await audioPlayer.load(file);
								audioPlayer.play();
							}
						}}
					>
						<Trans i18nKey="amll.contextMenu.play">播放</Trans>
					</ContextMenu.Item>
					<ContextMenu.Item
						onClick={() => {
							router.navigate(`/song/${song.id}`);
						}}
					>
						<Trans i18nKey="amll.contextMenu.editMusicOverrideMessage">
							编辑歌曲覆盖信息
						</Trans>
					</ContextMenu.Item>
				</ContextMenu.Content>
			</ContextMenu.Root>
		</Box>
	);
});
