import {
	ArrowLeftIcon,
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ClockIcon,
	Cross2Icon,
	ExclamationTriangleIcon,
	ExternalLinkIcon,
	MixerHorizontalIcon,
	PersonIcon,
	ReaderIcon,
	ReloadIcon,
} from "@radix-ui/react-icons";
import {
	Badge,
	Box,
	Button,
	Callout,
	Dialog,
	DropdownMenu,
	Flex,
	Heading,
	IconButton,
	Skeleton,
	Spinner,
	Tabs,
	Text,
	Tooltip,
} from "@radix-ui/themes";
import { useLiveQuery } from "dexie-react-hooks";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, {
	type ChangeEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { db } from "../../dexie";
import {
	currentMusicIndexAtom,
	currentMusicQueueAtom,
	onRequestPlaySongByIndexAtom,
} from "../../states/appAtoms";
import {
	auditLabelFilterAtom,
	currentAuditPrIdAtom,
	githubTokenAtom,
} from "../../states/auditAtoms";
import { formatRelativeTime } from "../../utils/time-format";
import styles from "./index.module.css";
import { NeteaseLoginDialog } from "./NeteaseLoginDialog";
import { PRActionsTab } from "./PRActionsTab";
import { PRAudioTab } from "./PRAudioTab";
import { PRInfoTab } from "./PRInfoTab";
import {
	AuditService,
	type GitHubLabel,
	type GitHubPR,
	type LabelFilter,
	type ReviewEvent,
} from "./services/audit-service";
import { neteaseCookieAtom } from "./services/neteaseAtoms";

const generatePagination = (current: number, total: number) => {
	if (total <= 1) return [1];

	const delta = 1;
	const range: number[] = [];
	const rangeWithDots: (number | string)[] = [];

	for (let i = 1; i <= total; i++) {
		if (
			i === 1 ||
			i === total ||
			(i >= current - delta && i <= current + delta)
		) {
			range.push(i);
		}
	}

	let l: number | null = null;
	for (const i of range) {
		if (l) {
			if (i - l === 2) {
				rangeWithDots.push(l + 1);
			} else if (i - l !== 1) {
				rangeWithDots.push("...");
			}
		}
		rangeWithDots.push(i);
		l = i;
	}

	return rangeWithDots;
};

const getPrAuthorName = (pr: GitHubPR) => {
	if (!pr.body) return pr.user.login;
	const match = pr.body.match(/### 歌词作者[\s\S]*?@([^\s]+)/);
	return match?.[1] ? match[1] : pr.user.login;
};

export const Component = () => {
	const navigate = useNavigate();
	const token = useAtomValue(githubTokenAtom);
	const [currentPrId, setCurrentPrId] = useAtom(currentAuditPrIdAtom);
	const [labelFilter, setLabelFilter] = useAtom(auditLabelFilterAtom);
	const [tempFilter, setTempFilter] = useState<LabelFilter[]>([]);
	const neteaseCookie = useAtomValue(neteaseCookieAtom);

	const setCurrentQueue = useSetAtom(currentMusicQueueAtom);
	const setCurrentIndex = useSetAtom(currentMusicIndexAtom);
	const requestPlaySong = useAtomValue(onRequestPlaySongByIndexAtom);

	const [prs, setPrs] = useState<GitHubPR[]>([]);
	const [availableLabels, setAvailableLabels] = useState<GitHubLabel[]>([]);
	const [page, setPage] = useState(1);
	const pageRef = useRef(page);
	const [totalCount, setTotalCount] = useState(0);
	const [loading, setLoading] = useState(false);
	const [processingPrId, setProcessingPrId] = useState<number | null>(null);
	const [reviewComment, setReviewComment] = useState("");
	const [actionLoading, setActionLoading] = useState(false);
	const [audioLoadStatus, setAudioLoadStatus] = useState<
		Record<string, string>
	>({});
	const [confirmDialog, setConfirmDialog] = useState<{
		open: boolean;
		title: string;
		description: string;
		actionLabel?: string;
		onConfirm: () => void;
	}>({
		open: false,
		title: "",
		description: "",
		onConfirm: () => {},
	});
	const closeDialog = () =>
		setConfirmDialog((prev) => ({ ...prev, open: false }));

	const handlePlayLocal = () => {
		if (!currentMeta) return;
		service.touchSong(currentMeta.songId);
		setCurrentQueue([currentMeta.songId]);
		requestPlaySong.onEmit(0);
	};

	const service = useMemo(() => {
		return new AuditService(token, "amll-dev", "amll-ttml-db");
	}, [token]);

	useEffect(() => {
		pageRef.current = page;
	}, [page]);

	const currentMeta = useLiveQuery(
		() =>
			currentPrId
				? db.auditMetadata.where({ prId: currentPrId }).first()
				: undefined,
		[currentPrId],
	);

	const currentSong = useLiveQuery(async () => {
		if (!currentMeta) return undefined;
		return db.songs.get(currentMeta.songId);
	}, [currentMeta]);

	useEffect(() => {
		AuditService.cleanGhostEntries();
	}, []);

	const loadPRs = useCallback(
		async (targetPage?: number) => {
			setLoading(true);

			const pageToFetch = targetPage ?? pageRef.current;

			try {
				if (labelFilter.length === 0) {
					const [list, count] = await Promise.all([
						service.fetchPullRequests(pageToFetch),
						service.fetchOpenPRCount(),
					]);
					setPrs(list);
					setTotalCount(count);
				} else {
					const [list, count] = await service.searchPullRequests(
						pageToFetch,
						labelFilter,
					);
					setPrs(list);
					setTotalCount(count);
				}
			} catch (e) {
				console.error(e);
				toast.error("加载列表失败");
			} finally {
				setLoading(false);
			}
		},
		[token, service, labelFilter],
	);

	useEffect(() => {
		if (token) {
			service
				.fetchRepoLabels()
				.then(setAvailableLabels)
				.catch((e) => console.warn("获取标签失败", e));
		}
	}, [token, service]);

	const handlePageChange = (newPage: number) => {
		setPage(newPage);
		loadPRs(newPage);
		setCurrentPrId(null);
		setReviewComment("");
	};

	const handleOpenChange = (open: boolean) => {
		if (open) {
			setTempFilter(labelFilter);
		} else {
			const isChanged =
				labelFilter.length !== tempFilter.length ||
				!labelFilter.every((l) =>
					tempFilter.some((t) => t.name === l.name && t.mode === l.mode),
				);

			if (isChanged) {
				setPage(1);
				setLabelFilter(tempFilter);
			}
		}
	};

	const getLabelState = (
		labelName: string,
		currentFilters: LabelFilter[],
	): "include" | "exclude" | "none" => {
		const found = currentFilters.find((f) => f.name === labelName);
		return found ? found.mode : "none";
	};

	const handleLeftClickLabel = (labelName: string) => {
		setTempFilter((prev) => {
			const currentState = getLabelState(labelName, prev);
			const cleanPrev = prev.filter((f) => f.name !== labelName);

			if (currentState === "include") {
				return cleanPrev;
			}
			return [...cleanPrev, { name: labelName, mode: "include" }];
		});
	};

	const handleRightClickLabel = (e: React.MouseEvent, labelName: string) => {
		e.preventDefault();
		setTempFilter((prev) => {
			const currentState = getLabelState(labelName, prev);
			const cleanPrev = prev.filter((f) => f.name !== labelName);

			if (currentState === "exclude") {
				return cleanPrev;
			}
			return [...cleanPrev, { name: labelName, mode: "exclude" }];
		});
	};

	useEffect(() => {
		loadPRs(1);
	}, [token, labelFilter]);

	const totalPages = Math.ceil(totalCount / 30) || 1;

	const handlePrClick = async (pr: GitHubPR) => {
		setCurrentPrId(pr.number);
		setProcessingPrId(pr.number);
		setAudioLoadStatus({});

		try {
			let targetPr = pr;
			if (!pr.head) {
				targetPr = await service.getPullRequestDetails(pr.number);
				setPrs((prev) =>
					prev.map((p) => (p.number === targetPr.number ? targetPr : p)),
				);
			}

			await service.processPR(targetPr);
		} catch (e) {
			console.error(e);
			toast.error("PR 解析失败");
		} finally {
			setProcessingPrId(null);
		}
	};

	const handlePlayId = useCallback(
		async (platformId: string) => {
			if (!currentMeta) return;

			const existingSong = await db.songs.get(currentMeta.songId);
			const hasValidFile = existingSong?.file && existingSong.file.size > 0;

			if (currentMeta.platformId === platformId && hasValidFile) {
				void service.touchSong(currentMeta.songId);

				setCurrentQueue([currentMeta.songId]);
				requestPlaySong.onEmit(0);
				toast.info("播放已缓存音频");
				return;
			}

			setAudioLoadStatus((prev) => ({ ...prev, [platformId]: "loading" }));

			try {
				const newSongId = await service.fetchAndBindAudio(
					currentMeta.songId,
					platformId,
					neteaseCookie || undefined,
				);

				setCurrentQueue([newSongId]);
				requestPlaySong.onEmit(0);

				setAudioLoadStatus((prev) => ({ ...prev, [platformId]: "idle" }));
			} catch (e) {
				console.error(e);
				toast.error(`音频下载失败: ${e}`);
				setAudioLoadStatus((prev) => ({ ...prev, [platformId]: "error" }));
			}
		},
		[currentMeta, requestPlaySong, service, setCurrentQueue],
	);

	const handleReview = useCallback(
		async (event: ReviewEvent) => {
			if (!currentPrId) return;

			if (event === "REQUEST_CHANGES" && !reviewComment.trim()) {
				toast.error("打回 PR 时必须填写原因");
				return;
			}

			setConfirmDialog({
				open: true,
				title: `确认${event === "APPROVE" ? "批准" : "打回"}此 PR 吗?`,
				description: "同时也会将评论内容发布到PR中",
				actionLabel: "确定",
				onConfirm: async () => {
					setActionLoading(true);
					try {
						await service.submitReview(currentPrId, event, reviewComment);
						toast.success(`提交成功: ${event}`);
						setReviewComment("");
						loadPRs();
					} catch (e) {
						console.error(e);
						toast.error(
							`提交失败：${e instanceof Error ? e.message : "未知错误"}`,
						);
					} finally {
						setActionLoading(false);
						closeDialog();
					}
				},
			});
		},
		[currentPrId, reviewComment, service],
	);

	const handleMerge = useCallback(async () => {
		if (!currentPrId) return;

		setConfirmDialog({
			open: true,
			title: `确认合并 #${currentPrId} 吗？`,
			description: `这将把评论内容发布到PR中并关闭PR`,
			actionLabel: "确定",
			onConfirm: async () => {
				setActionLoading(true);
				try {
					await service.mergePullRequest(currentPrId, "squash");

					if (reviewComment.trim()) {
						try {
							await service.submitReview(currentPrId, "COMMENT", reviewComment);
						} catch (commentErr) {
							console.warn("发送评论失败", commentErr);
							toast.warn("PR 已合并，但评论发送失败");
						}
					} else {
						toast.success("PR 已成功合并！");
					}

					setPrs((prev) => prev.filter((p) => p.number !== currentPrId));
					setCurrentPrId(null);
					setCurrentQueue([]);
					setReviewComment("");
				} catch (e) {
					console.error(e);
					toast.error(
						`合并失败：${e instanceof Error ? e.message : "未知错误"}`,
					);
				} finally {
					setActionLoading(false);
					closeDialog();
				}
			},
		});
	}, [currentPrId, reviewComment, service, setCurrentPrId, setCurrentQueue]);

	const handleFileUpload = useCallback(
		async (e: ChangeEvent<HTMLInputElement>) => {
			if (!e.target.files?.[0] || !currentMeta) return;
			const file = e.target.files[0];

			try {
				await service.linkLocalFile(currentMeta.songId, file);
				setAudioLoadStatus({});
				setCurrentQueue([currentMeta.songId]);
				requestPlaySong.onEmit(0);
				setCurrentIndex(0);

				toast.success("本地音频已加载并开始播放");
			} catch (e) {
				console.error(e);
				toast.error("关联文件失败");
			}
		},
		[currentMeta, service, setCurrentQueue, requestPlaySong, setCurrentIndex],
	);

	const selectedPr = prs.find((p) => p.number === currentPrId);

	const candidateIds = currentMeta?.candidateIds || [];

	return (
		<div className={styles.container}>
			<Dialog.Root
				open={confirmDialog.open}
				onOpenChange={(open) => !open && closeDialog()}
			>
				<Dialog.Content style={{ maxWidth: 450 }}>
					<Dialog.Title>{confirmDialog.title}</Dialog.Title>
					<Dialog.Description size="2" mb="4">
						{confirmDialog.description}
					</Dialog.Description>

					<Flex gap="3" mt="4" justify="end">
						<Dialog.Close>
							<Button variant="soft" color="gray">
								取消
							</Button>
						</Dialog.Close>
						<Button
							color="red"
							onClick={confirmDialog.onConfirm}
							disabled={actionLoading}
						>
							{actionLoading && <Spinner style={{ marginRight: 8 }} />}
							{confirmDialog.actionLabel || "确认"}
						</Button>
					</Flex>
				</Dialog.Content>
			</Dialog.Root>
			<div className={styles.sidebar}>
				<Flex
					justify="between"
					align="center"
					className={styles.sidebarHeader}
					style={{
						padding: "12px 16px",
						borderBottom: "1px solid var(--gray-a4)",
					}}
				>
					<Flex align="center" gap="3">
						<Tooltip content="返回上一页">
							<IconButton
								variant="ghost"
								color="gray"
								onClick={() => navigate(-1)}
								style={{ margin: 0 }}
							>
								<ArrowLeftIcon width="20" height="20" />
							</IconButton>
						</Tooltip>

						<Text weight="bold" size="3">
							待审核 PR ({totalCount})
						</Text>
					</Flex>

					<Flex align="center" gap="3">
						<DropdownMenu.Root onOpenChange={handleOpenChange}>
							<DropdownMenu.Trigger>
								<IconButton
									variant={labelFilter.length > 0 ? "solid" : "ghost"}
									color={labelFilter.length > 0 ? "blue" : "gray"}
								>
									<MixerHorizontalIcon width="18" height="18" />
								</IconButton>
							</DropdownMenu.Trigger>
							<DropdownMenu.Content
								style={{ maxHeight: "300px", overflowY: "auto" }}
							>
								<DropdownMenu.Label>筛选</DropdownMenu.Label>
								{availableLabels.length === 0 ? (
									<DropdownMenu.Item disabled>加载标签中...</DropdownMenu.Item>
								) : (
									availableLabels.map((label) => {
										const state = getLabelState(label.name, tempFilter);

										return (
											<DropdownMenu.Item
												key={label.id}
												onSelect={(e) => {
													e.preventDefault();
													handleLeftClickLabel(label.name);
												}}
												onContextMenu={(e) =>
													handleRightClickLabel(e, label.name)
												}
											>
												<Flex align="center" gap="2" style={{ width: "100%" }}>
													<div
														style={{
															width: 16,
															display: "flex",
															alignItems: "center",
															justifyContent: "center",
														}}
													>
														{state === "include" && (
															<CheckIcon width="16" height="16" />
														)}
														{state === "exclude" && (
															<Cross2Icon
																width="16"
																height="16"
																color="var(--red-9)"
															/>
														)}
													</div>

													<div
														style={{
															width: 8,
															height: 8,
															borderRadius: "50%",
															backgroundColor: `#${label.color}`,
														}}
													/>

													<Text
														style={{
															textDecoration:
																state === "exclude" ? "line-through" : "none",
															opacity: state === "exclude" ? 0.7 : 1,
															color:
																state === "exclude"
																	? "var(--red-11)"
																	: "inherit",
														}}
													>
														{label.name}
													</Text>
												</Flex>
											</DropdownMenu.Item>
										);
									})
								)}
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<Tooltip content="刷新列表">
							<IconButton
								variant="solid"
								onClick={() => loadPRs(page)}
								disabled={loading}
							>
								<ReloadIcon width="18" height="18" />
							</IconButton>
						</Tooltip>
					</Flex>
				</Flex>
				<div className={styles.prList}>
					{loading
						? Array.from({ length: 10 }).map((_, i) => (
								<div
									key={i}
									className={styles.prItem}
									style={{ pointerEvents: "none" }}
								>
									<div style={{ marginBottom: "6px" }}>
										<Skeleton height="16px" width="100%" />
									</div>
									<div style={{ marginBottom: "8px" }}>
										<Skeleton height="14px" width="40%" />
									</div>
									<Flex gap="1">
										<Skeleton
											height="18px"
											width="45px"
											style={{ borderRadius: "10px" }}
										/>
										<Skeleton
											height="18px"
											width="60px"
											style={{ borderRadius: "10px" }}
										/>
									</Flex>
								</div>
							))
						: prs.map((pr) => {
								const displayAuthor = getPrAuthorName(pr);

								return (
									<button
										type="button"
										key={pr.id}
										className={`${styles.prItem} ${currentPrId === pr.number ? styles.active : ""}`}
										onClick={() => handlePrClick(pr)}
									>
										<Flex justify="between" align="start" mb="1">
											<Text
												weight="bold"
												size="2"
												style={{ color: "var(--gray-12)", opacity: 0.5 }}
											>
												#{pr.number}
											</Text>
											<Flex align="center" gap="1">
												<ClockIcon
													width="11"
													height="11"
													style={{ opacity: 0.7 }}
												/>
												<Text size="1" color="gray">
													{formatRelativeTime(pr.created_at)}
												</Text>
											</Flex>
										</Flex>

										<div
											className={styles.prTitle}
											style={{ marginBottom: "4px" }}
										>
											{pr.title}
										</div>

										<Flex align="center" gap="1">
											<PersonIcon
												width="11"
												height="11"
												style={{ opacity: 0.7 }}
											/>
											<Text size="1" color="gray">
												{displayAuthor}
											</Text>
										</Flex>

										{pr.labels && pr.labels.length > 0 && (
											<Flex gap="1" wrap="wrap" mt="2">
												{pr.labels.map((label) => (
													<Badge
														key={label.id}
														variant="solid"
														radius="full"
														style={{
															backgroundColor: `#${label.color}`,
														}}
													>
														{label.name}
													</Badge>
												))}
											</Flex>
										)}
									</button>
								);
							})}

					{!loading && prs.length === 0 && (
						<Box p="4">
							<Text align="center" color="gray">
								暂无待审核 PR
							</Text>
						</Box>
					)}
				</div>
				<Flex justify="center" align="center" p="2" gap="3" style={{}}>
					<IconButton
						variant="ghost"
						disabled={page <= 1 || loading}
						onClick={() => handlePageChange(page - 1)}
						size="1"
					>
						<ChevronLeftIcon width="16" height="16" />
					</IconButton>

					{generatePagination(page, totalPages).map((p, index) =>
						typeof p === "number" ? (
							<Button
								key={index}
								variant={p === page ? "solid" : "outline"}
								color={p === page ? "indigo" : "gray"}
								onClick={() => handlePageChange(p)}
								size="1"
								style={{
									minWidth: "24px",
									minHeight: "24px",
									padding: "0",
									cursor: "pointer",
								}}
							>
								{p}
							</Button>
						) : (
							<Text
								key={index}
								size="1"
								color="gray"
								style={{ userSelect: "none" }}
							>
								...
							</Text>
						),
					)}

					<IconButton
						variant="ghost"
						disabled={page >= totalPages || loading}
						onClick={() => handlePageChange(page + 1)}
						size="1"
					>
						<ChevronRightIcon width="16" height="16" />
					</IconButton>
				</Flex>
				<div style={{ padding: "8px", borderTop: "1px solid var(--gray-a4)" }}>
					<NeteaseLoginDialog />
				</div>
			</div>

			<div
				className={styles.workspace}
				style={{ padding: 0, overflow: "hidden" }}
			>
				{selectedPr ? (
					<Flex direction="column" style={{ height: "100%" }}>
						{!token && (
							<Callout.Root
								color="amber"
								style={{ margin: "12px 24px 0 24px", flexShrink: 0 }}
							>
								<Callout.Icon>
									<ExclamationTriangleIcon />
								</Callout.Icon>
								<Callout.Text>
									<Text weight="bold" as="div" size="2" mb="1">
										仅浏览模式
									</Text>
									未配置 GitHub PAT，只能浏览PR。如需进行审核，请前往{" "}
									<Link to="/settings">设置 &gt; 审核模式</Link> 配置 PAT。
								</Callout.Text>
							</Callout.Root>
						)}
						<div
							style={{
								padding: "24px 24px 22px 24px",
							}}
						>
							<a
								href={selectedPr.html_url}
								target="_blank"
								rel="noopener noreferrer"
								className={styles.animatedLink}
								style={{ color: "var(--gray-12)", marginBottom: "8px" }}
							>
								<Heading size="6">
									#{selectedPr.number} {selectedPr.title}
								</Heading>
								<ExternalLinkIcon width="24" height="24" />
							</a>

							<Flex align="center" gap="1">
								<ClockIcon style={{ width: 12, height: 12 }} />
								<Text color="gray" size="2">
									{new Date(selectedPr.created_at).toLocaleString()}
								</Text>
							</Flex>
						</div>

						<Tabs.Root
							defaultValue="info"
							style={{
								flex: 1,
								display: "flex",
								flexDirection: "column",
								overflow: "hidden",
							}}
						>
							<div
								style={{
									padding: "0 26px",
								}}
							>
								<Tabs.List>
									<Tabs.Trigger value="info">简介</Tabs.Trigger>
									<Tabs.Trigger value="audio">音源</Tabs.Trigger>
									<Tabs.Trigger value="actions">操作</Tabs.Trigger>
								</Tabs.List>
							</div>

							<Tabs.Content value="info" style={{ flex: 1, overflowY: "auto" }}>
								<PRInfoTab pr={selectedPr} repoUrl={service.repoUrl} />
							</Tabs.Content>
							<Tabs.Content
								value="audio"
								style={{ flex: 1, overflowY: "auto" }}
							>
								<PRAudioTab
									isProcessing={processingPrId === selectedPr.number}
									candidateIds={candidateIds}
									currentPlatformId={currentMeta?.platformId}
									currentSongName={currentSong?.songName}
									audioLoadStatus={audioLoadStatus}
									onPlayId={handlePlayId}
									onPlayLocal={handlePlayLocal}
									onFileUpload={handleFileUpload}
								/>
							</Tabs.Content>

							<Tabs.Content
								value="actions"
								style={{ flex: 1, overflowY: "auto" }}
							>
								<PRActionsTab
									reviewComment={reviewComment}
									onCommentChange={setReviewComment}
									actionLoading={actionLoading}
									onReview={handleReview}
									onMerge={handleMerge}
								/>
							</Tabs.Content>
						</Tabs.Root>
					</Flex>
				) : (
					<Flex
						align="center"
						justify="center"
						direction="column"
						gap="4"
						style={{ height: "100%", opacity: 0.75 }}
					>
						<ReaderIcon width="64" height="64" />
						<Text size="3">在左侧选择一个 PR 以开始审核</Text>
					</Flex>
				)}
			</div>
		</div>
	);
};
