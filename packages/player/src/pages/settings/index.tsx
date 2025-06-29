import {
	ArrowLeftIcon,
	Component1Icon,
	DesktopIcon,
	GearIcon,
	InfoCircledIcon,
	MagicWandIcon,
	MixerHorizontalIcon,
	QuestionMarkCircledIcon,
	TextAlignJustifyIcon,
} from "@radix-ui/react-icons";
import {
	Box,
	Button,
	Flex,
	Separator,
	Text,
	Tooltip,
} from "@radix-ui/themes";
import { platform } from "@tauri-apps/plugin-os";
import { atom, useAtom, useAtomValue } from "jotai";
import { Suspense, type FC, type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadedExtensionAtom } from "@applemusic-like-lyrics/states";
import { ExtensionTab } from "./extension.tsx";
import { PlayerSettingsTab } from "./player.tsx";

const currentPageAtom = atom("player.general");

const loadedExtensionsWithSettingsAtom = atom((get) => {
	const loadedExtensions = get(loadedExtensionAtom);
	return loadedExtensions.filter(
		(v) => v.context.registeredInjectPointComponent.settings,
	);
});

const usePlatform = () => {
	const [os, setOs] = useState<string | null>(null);

	useEffect(() => {
		setOs(platform());
	}, []);

	return os;
};

const SidebarButton: FC<{
	icon: ReactNode;
	label: string;
	isActive: boolean;
	onClick: () => void;
}> = ({ icon, label, isActive, onClick }) => {
	return (
		<Button
			variant="soft"
			color={isActive ? ("accent" as any) : "gray"}
			onClick={onClick}
			style={{ justifyContent: "flex-start", cursor: "pointer" }}
			size="3"
			data-state={isActive ? 'active' : 'inactive'}
		>
			<Flex gap="3" align="center" style={{ minWidth: 0 }}>
				{icon}
				<Text truncate>{label}</Text>
			</Flex>
		</Button>
	);
};


export const Component: FC = () => {
	const os = usePlatform();
	const [currentPage, setCurrentPage] = useAtom(currentPageAtom);
	const loadedExtensions = useAtomValue(loadedExtensionsWithSettingsAtom);
	const { t, i18n } = useTranslation();

	const playerSettingsPages = useMemo(() => {
		const pages = [
			{ id: "general", label: t("page.settings.general.subtitle"), icon: <GearIcon width={20} height={20} /> },
			{ id: "lyricContent", label: t("page.settings.lyricContent.subtitle"), icon: <TextAlignJustifyIcon width={20} height={20} /> },
			{ id: "lyricAppearance", label: t("page.settings.lyricAppearance.subtitle"), icon: <MagicWandIcon width={20} height={20} /> },
			{ id: "musicInfoAppearance", label: t("page.settings.musicInfoAppearance.subtitle"), icon: <InfoCircledIcon width={20} height={20} /> },
			{ id: "lyricBackground", label: t("page.settings.lyricBackground.subtitle"), icon: <MixerHorizontalIcon width={20} height={20} /> },
			{ id: "others", label: t("page.settings.others.subtitle"), icon: <Component1Icon width={20} height={20} /> },
		];

		if (os === 'windows') {
			pages.push({
				id: 'smtc',
				label: t("page.settings.smtc.subtitle", "SMTC 监听设置"),
				icon: <DesktopIcon width={20} height={20} />
			});
		}

		pages.push({ id: "about", label: t("page.about.subtitle"), icon: <QuestionMarkCircledIcon width={20} height={20} /> });

		return pages;
	}, [os, t]);

	const renderContent = () => {
		if (currentPage.startsWith("player.")) {
			const category = currentPage.split(".")[1];
			return <PlayerSettingsTab category={category} />;
		}

		if (currentPage === "extension.management") {
			return (
				<Suspense>
					<ExtensionTab />
				</Suspense>
			);
		}

		if (currentPage.startsWith("extension.")) {
			const extensionId = currentPage.substring(10);
			const extension = loadedExtensions.find(ext => ext.extensionMeta.id === extensionId);
			const ExtensionSettingsComponent = extension?.context.registeredInjectPointComponent.settings;

			if (ExtensionSettingsComponent) {
				return <ExtensionSettingsComponent />;
			}
		}

		return null;
	};

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: "80px",
				zIndex: 1000,
			}}
		>
			<style>{`
				.rt-Button[data-state='inactive'] {
					background-color: transparent !important;
				}
				.rt-Button[data-state='inactive']:hover {
					background-color: var(--gray-a3) !important;
				}
				.rt-Button:active {
					transform: none;
				}
			`}</style>

			<Box
				style={{
					position: 'absolute',
					top: 'var(--space-4)',
					left: 'var(--space-4)',
					zIndex: 10
				}}
			>
				<Tooltip content={t("common.page.back", "返回")}>
					<Button variant="soft" onClick={() => history.back()} size="3">
						<ArrowLeftIcon />
					</Button>
				</Tooltip>
			</Box>

			<Flex
				direction="row"
				gap="4"
				height="100%"
				style={{
					paddingTop: 'calc(var(--space-4) + var(--space-7) + var(--space-4))',
					paddingLeft: 'var(--space-4)',
					paddingRight: 'var(--space-4)',
					paddingBottom: 'var(--space-4)'
				}}
			>
				<Box style={{ width: "220px", flexShrink: 0 }}>
					<Flex direction="column" gap="1">
						{playerSettingsPages.map((page) => (
							<SidebarButton
								key={`player.${page.id}`}
								icon={page.icon}
								label={page.label}
								isActive={currentPage === `player.${page.id}`}
								onClick={() => setCurrentPage(`player.${page.id}`)}
							/>
						))}
						<Separator my="2" size="4" />
						<SidebarButton
							key="extension.management"
							icon={<Component1Icon width={20} height={20} />}
							label={t("settings.extension.tab", "扩展程序管理")}
							isActive={currentPage === "extension.management"}
							onClick={() => setCurrentPage("extension.management")}
						/>
						{loadedExtensions.map((extension) => {
							const id = extension.extensionMeta.id;
							return (
								<SidebarButton
									key={`extension.${id}`}
									icon={<img src={String(extension.context.extensionMeta.icon)} width="20" height="20" />}
									label={i18n.getFixedT(null, id as any)("name", id)}
									isActive={currentPage === `extension.${id}`}
									onClick={() => setCurrentPage(`extension.${id}`)}
								/>
							);
						})}
					</Flex>
				</Box>

				<Box flexGrow="1" minWidth="0" minHeight="0" overflowY="auto">
					{renderContent()}
				</Box>
			</Flex>
		</div>
	);
};

Component.displayName = "SettingsPage";

export default Component;