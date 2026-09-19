// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { FileIcon, PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { useRef } from "react";
import {
	base64DecodedSize,
	formatBytes,
	type OutgoingFileAttachment,
} from "~/lib/utils";

interface ComposeAttachmentsProps {
	attachments: OutgoingFileAttachment[];
	onAdd: (files: File[]) => void;
	onRemove: (index: number) => void;
	disabled?: boolean;
}

export default function ComposeAttachments({
	attachments,
	onAdd,
	onRemove,
	disabled,
}: ComposeAttachmentsProps) {
	const inputRef = useRef<HTMLInputElement>(null);

	return (
		<div className="space-y-2">
			<input
				ref={inputRef}
				type="file"
				multiple
				className="hidden"
				onChange={(e) => {
					onAdd(Array.from(e.target.files ?? []));
					e.target.value = "";
				}}
			/>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				icon={<PaperclipIcon size={14} />}
				onClick={() => inputRef.current?.click()}
				disabled={disabled}
			>
				Attach files
			</Button>
			{attachments.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{attachments.map((attachment, index) => (
						<span
							key={`${attachment.filename}-${index}`}
							className="flex items-center gap-2 rounded-md border border-kumo-line px-3 py-1.5 text-sm"
						>
							<FileIcon size={16} className="text-kumo-subtle shrink-0" />
							<span className="text-kumo-default font-medium truncate max-w-[180px]">
								{attachment.filename}
							</span>
							<span className="text-kumo-subtle">
								{formatBytes(base64DecodedSize(attachment.content))}
							</span>
							<button
								type="button"
								onClick={() => onRemove(index)}
								disabled={disabled}
								aria-label={`Remove ${attachment.filename}`}
								className="text-kumo-subtle hover:text-kumo-default"
							>
								<XIcon size={14} />
							</button>
						</span>
					))}
				</div>
			)}
		</div>
	);
}
