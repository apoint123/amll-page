import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { LabelFilter } from "../pages/audit/services/audit-service";

export const isAuditModeAtom = atom(false);

export const githubTokenAtom = atomWithStorage<string>(
	"amll-player.audit.githubToken",
	"",
	undefined,
	{ getOnInit: true },
);

export const currentAuditPrIdAtom = atom<number | null>(null);

export const auditListRefreshAtom = atom(0);

export const auditProcessingStateAtom = atom<{
	prId: number;
	status: "idle" | "downloading" | "processing" | "error";
	message?: string;
} | null>(null);

export const enableAuditModeAtom = atomWithStorage<boolean>(
	"amll-player.audit.enable",
	false,
);

export const auditLabelFilterAtom = atomWithStorage<LabelFilter[]>(
	"amll-player.audit.labelFilter",
	[],
);
