// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Email sending via Cloudflare Email Service binding.
 *
 * Uses the `send_email` Worker binding (`env.EMAIL.send()`) to send emails.
 *
 * See: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
 */

export interface SendEmailParams {
	to: string | string[];
	from: string | { email: string; name: string };
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string | { email: string; name: string };
	attachments?: {
		content: string; // base64 encoded
		filename: string;
		type: string;
		disposition: "attachment" | "inline";
		contentId?: string;
	}[];
	headers?: Record<string, string>;
}

/**
 * Send an email using the Cloudflare Email Service binding.
 *
 * @param binding  - The `EMAIL` SendEmail binding from env
 * @param params   - Email parameters (to, from, subject, body, etc.)
 * @returns The send result with messageId
 * @throws On validation or delivery errors (error has `.code` property)
 */
export async function sendEmail(
	binding: SendEmail,
	params: SendEmailParams,
): Promise<{ messageId: string }> {
	const message: Record<string, unknown> = {
		to: params.to,
		from: params.from,
		subject: params.subject,
	};

	if (params.html) message.html = params.html;
	if (params.text) message.text = params.text;
	if (params.cc) message.cc = params.cc;
	if (params.bcc) message.bcc = params.bcc;
	if (params.replyTo) message.replyTo = params.replyTo;

	if (params.headers && Object.keys(params.headers).length > 0) {
		message.headers = params.headers;
	}

	if (params.attachments && params.attachments.length > 0) {
		message.attachments = params.attachments.map((att) => ({
			content: att.content,
			filename: att.filename,
			type: att.type,
			disposition: att.disposition,
			...(att.contentId ? { contentId: att.contentId } : {}),
		}));
	}

	let result: { messageId: string } | null = null;
	let sendError: unknown = null;
	try {
		result = await binding.send(message as any);
	} catch (e) {
		sendError = e;
	}

	await reportSendDebug(binding, params, message, result, sendError);

	if (sendError) throw sendError;
	return { messageId: result!.messageId };
}

/**
 * Temporary diagnostics for inline-image sending.
 * Logs the exact payload handed to the EMAIL binding and delivers it as a
 * plain-text follow-up email to the same recipient, so the result can be
 * inspected in the recipient's mailbox.
 */
async function reportSendDebug(
	binding: SendEmail,
	params: SendEmailParams,
	message: Record<string, unknown>,
	result: { messageId: string } | null,
	sendError: unknown,
): Promise<void> {
	try {
		const cidRefs = params.html?.match(/cid:[^"'\s>]+/g) ?? [];
		const attachments = (message.attachments as SendEmailParams["attachments"]) ?? [];
		const lines = [
			`time: ${new Date().toISOString()}`,
			`to: ${JSON.stringify(params.to)}`,
			`from: ${JSON.stringify(params.from)}`,
			`subject: ${params.subject}`,
			`hasHtml: ${Boolean(params.html)} (length ${params.html?.length ?? 0})`,
			`hasText: ${Boolean(params.text)} (length ${params.text?.length ?? 0})`,
			`cid refs in html: ${cidRefs.length > 0 ? cidRefs.join(", ") : "(none)"}`,
			`attachments: ${attachments.length}`,
			...attachments.map((att, i) =>
				[
					`  [${i}] filename=${att.filename}`,
					`type=${att.type}`,
					`disposition=${att.disposition}`,
					`contentId=${att.contentId ?? "(none)"}`,
					`base64Length=${att.content.length}`,
					`base64Head=${att.content.slice(0, 48)}...`,
				].join(" "),
			),
			`result: ${result ? `OK messageId=${result.messageId}` : `FAILED ${(sendError as Error)?.message} (code ${(sendError as { code?: string })?.code ?? "?"})`}`,
		];
		const log = lines.join("\n");
		console.log(`[send-debug]\n${log}`);

		await binding.send({
			to: params.to,
			from: params.from,
			subject: `[send-debug] ${params.subject}`,
			text: log,
		} as any);
	} catch (e) {
		console.error("[send-debug] failed to report:", (e as Error).message);
	}
}
