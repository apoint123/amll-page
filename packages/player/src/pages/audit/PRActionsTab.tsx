import { MagicWandIcon } from "@radix-ui/react-icons";
import {
	Box,
	Button,
	DropdownMenu,
	Flex,
	Text,
	TextArea,
	Tooltip,
} from "@radix-ui/themes";
import type { ReviewEvent } from "../../services/audit-service";
import styles from "./index.module.css";

const REPLY_TEMPLATES = [
	{
		label: "✅ 完美通过",
		content:
			"恭喜你，人工审核通过，你的贡献将会被更多人看到。感谢你对本项目的支持。欢迎下次投稿！",
	},
	{
		label: "⚠️ 需要修正",
		content:
			"感谢你的慷慨贡献，但是很遗憾，本次人工审核你没有成功通过。建议参考以下内容修改并更新歌词，期待你更高质量的投稿！\n以下为这份歌词存在的问题：\n - ...\n - ...",
	},
];

interface PRActionsTabProps {
	reviewComment: string;
	onCommentChange: (val: string) => void;
	actionLoading: boolean;
	onReview: (event: ReviewEvent) => void;
	onMerge: () => void;
}

export const PRActionsTab = ({
	reviewComment,
	onCommentChange,
	actionLoading,
	onReview,
	onMerge,
}: PRActionsTabProps) => {
	const insertTemplate = (content: string) => {
		onCommentChange(reviewComment ? `${reviewComment}\n${content}` : content);
	};

	return (
		<Box p="5">
			<Flex justify="between" align="end" mb="2">
				<Text size="2" color="gray" as="div">
					支持 Markdown，暂不支持预览
					<br />
					如果有问题请标明行号和问题原因，最好一次列出尽可能多的问题，方便提交者更全面地修正问题噢！
					<br />
					如果没有问题但是有可以改进的地方，也可以合并后加以评论噢！
				</Text>

				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						<Button
							variant="ghost"
							size="2"
							style={{ marginRight: "1px", marginBottom: "0px" }}
						>
							<MagicWandIcon /> 插入回复模版
						</Button>
					</DropdownMenu.Trigger>
					<DropdownMenu.Content>
						<DropdownMenu.Label>选择模版</DropdownMenu.Label>
						{REPLY_TEMPLATES.map((tpl, index) => (
							<DropdownMenu.Item
								key={index}
								onClick={() => insertTemplate(tpl.content)}
							>
								{tpl.label}
							</DropdownMenu.Item>
						))}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</Flex>

			<TextArea
				placeholder="评论内容，会在 Approve, Request changes 和 Merge 时自动附加。留空则不附加"
				value={reviewComment}
				onChange={(e) => onCommentChange(e.target.value)}
				rows={10}
				style={{ marginBottom: "24px", resize: "vertical" }}
			/>

			<div
				className={styles.actionButtons}
				style={{ flexDirection: "column", gap: "12px" }}
			>
				<Flex gap="3">
					<Tooltip content="批准此 PR">
						<Box style={{ flex: 1 }}>
							<Button
								color="green"
								variant="soft"
								disabled={actionLoading}
								onClick={() => onReview("APPROVE")}
								style={{ width: "100%" }}
							>
								Approve
							</Button>
						</Box>
					</Tooltip>

					<Tooltip
						content={
							!reviewComment.trim() ? "必须填写评论才能请求更改" : "请求更改"
						}
					>
						<Box style={{ flex: 1 }}>
							<Button
								color="amber"
								variant="soft"
								disabled={actionLoading || !reviewComment.trim()}
								onClick={() => onReview("REQUEST_CHANGES")}
								style={{ width: "100%" }}
							>
								Request Changes
							</Button>
						</Box>
					</Tooltip>
				</Flex>

				<Flex gap="3" mt="2">
					<Tooltip content="合并此 PR">
						<Box style={{ flex: 2 }}>
							<Button
								color="purple"
								variant="solid"
								disabled={actionLoading}
								onClick={onMerge}
								style={{ width: "100%", height: "40px" }}
							>
								Merge
							</Button>
						</Box>
					</Tooltip>
				</Flex>
			</div>
		</Box>
	);
};
