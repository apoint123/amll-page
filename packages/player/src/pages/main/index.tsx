import {
	GearIcon,
	HamburgerMenuIcon,
	Link1Icon,
	MagnifyingGlassIcon,
	PersonIcon,
} from "@radix-ui/react-icons";
import {
	Box,
	DropdownMenu,
	Flex,
	Heading,
	IconButton,
	Spinner,
	Text,
} from "@radix-ui/themes";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLiveQuery } from "dexie-react-hooks";
import { useAtomValue } from "jotai";
import { type FC, useRef } from "react";
import { Trans } from "react-i18next";
import { Link } from "react-router-dom";
import { NewPlaylistButton } from "../../components/NewPlaylistButton/index.tsx";
import { PageContainer } from "../../components/PageContainer/index.tsx";
import { PlaylistCard } from "../../components/PlaylistCard/index.tsx";
import { AUDIT_PLAYLIST_ID, db } from "../../dexie.ts";
import { enableAuditModeAtom } from "../../states/auditAtoms.ts";

export const Component: FC = () => {
	const playlists = useLiveQuery(() =>
		db.playlists.filter((p) => p.id !== AUDIT_PLAYLIST_ID).toArray(),
	);
	const parentRef = useRef<HTMLDivElement>(null);

	const isAuditModeEnabled = useAtomValue(enableAuditModeAtom);

	const rowVirtualizer = useVirtualizer({
		count: playlists?.length ?? 0,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 105,
		overscan: 5,
	});

	return (
		<PageContainer>
			<Flex direction="column" height="100%">
				<Flex direction="row" align="center" wrap="wrap" mt="5">
					<Box asChild flexGrow="1">
						<Heading wrap="nowrap" my="4">
							AMLL Player
						</Heading>
					</Box>
					<Flex gap="1" wrap="wrap">
						<IconButton variant="soft" asChild>
							<Link to="/search">
								<MagnifyingGlassIcon />
							</Link>
						</IconButton>
						<NewPlaylistButton />
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								<IconButton variant="soft">
									<HamburgerMenuIcon />
								</IconButton>
							</DropdownMenu.Trigger>
							<DropdownMenu.Content>
								{isAuditModeEnabled && (
									<DropdownMenu.Item asChild>
										<Link to="/audit">
											<Flex align="center" gap="2">
												<PersonIcon />
												<Trans i18nKey="page.main.menu.auditMode">
													歌词审核模式
												</Trans>
											</Flex>
										</Link>
									</DropdownMenu.Item>
								)}

								<DropdownMenu.Item asChild>
									<Link to="/ws-mode">
										<Flex align="center" gap="2">
											<Link1Icon />
											<Trans i18nKey="page.main.menu.wsMode">
												WS Protocol 模式
											</Trans>
										</Flex>
									</Link>
								</DropdownMenu.Item>

								<DropdownMenu.Item asChild>
									<Link to="/settings">
										<Flex align="center" gap="2">
											<GearIcon />
											<Trans i18nKey="page.main.menu.settings">设置</Trans>
										</Flex>
									</Link>
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</Flex>
				</Flex>

				{playlists !== undefined ? (
					playlists.length === 0 ? (
						<Text mt="9" as="div" align="center">
							<Trans i18nKey="page.main.noPlaylistTip">
								没有播放列表，快去新建一个吧！
							</Trans>
						</Text>
					) : (
						<div
							style={{
								overflowY: "auto",
								minHeight: "0",
							}}
							ref={parentRef}
						>
							<div
								style={{
									height: `${rowVirtualizer.getTotalSize()}px`,
									width: "100%",
									position: "relative",
								}}
							>
								{rowVirtualizer.getVirtualItems().map((virtualItem) => {
									const playlist = playlists[virtualItem.index];
									return (
										<div
											key={virtualItem.key}
											style={{
												position: "absolute",
												top: 0,
												left: 0,
												width: "100%",
												padding: "4px 8px",
												height: `${virtualItem.size}px`,
												transform: `translateY(${virtualItem.start}px)`,
												boxSizing: "border-box",
											}}
										>
											<PlaylistCard playlist={playlist} />
										</div>
									);
								})}
							</div>
						</div>
					)
				) : (
					<Flex
						direction="column"
						gap="2"
						justify="center"
						align="center"
						height="70vh"
					>
						<Spinner size="3" />
						<Trans i18nKey="page.main.loadingPlaylist">加载歌单中</Trans>
					</Flex>
				)}
			</Flex>
		</PageContainer>
	);
};

Component.displayName = "MainPage";

export default Component;
