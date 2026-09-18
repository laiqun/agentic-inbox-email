// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Email sending via Cloudflare Email Service binding.
 *
 * Builds the RFC 5322 message with mimetext (full control over multipart
 * structure and Content-ID headers for inline images) and sends it through
 * the `EMAIL` SendEmail binding as a raw EmailMessage.
 *
 * See: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
 */

import { EmailMessage } from "cloudflare:email";
import { createMimeMessage, Mailbox } from "mimetext";

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

function toAddressList(value: string | string[] | undefined): string[] {
	if (!value) return [];
	return (Array.isArray(value) ? value : [value]).filter(Boolean);
}

function utf8ToBase64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
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
	const from: { email: string; name?: string } =
		typeof params.from === "string" ? { email: params.from } : params.from;
	const toList = toAddressList(params.to);
	const ccList = toAddressList(params.cc);
	const bccList = toAddressList(params.bcc);

	const msg = createMimeMessage();
	msg.setSender({ addr: from.email, ...(from.name ? { name: from.name } : {}) });
	msg.setTo(toList);
	if (ccList.length > 0) msg.setCc(ccList);
	// Bcc is envelope-only by design: never written into the message headers.
	msg.setSubject(params.subject);
	if (params.replyTo) {
		const replyTo =
			typeof params.replyTo === "string"
				? params.replyTo
				: `"${params.replyTo.name}" <${params.replyTo.email}>`;
		msg.setHeader("Reply-To", new Mailbox(replyTo, { type: "From" }));
	}
	if (params.headers) {
		for (const [name, value] of Object.entries(params.headers)) {
			msg.setHeader(name, value);
		}
	}

	// Bodies are base64-encoded so non-ASCII content survives transport.
	if (params.text) {
		msg.addMessage({
			contentType: "text/plain",
			data: utf8ToBase64(params.text),
			encoding: "base64",
		});
	}
	if (params.html) {
		msg.addMessage({
			contentType: "text/html",
			data: utf8ToBase64(params.html),
			encoding: "base64",
		});
	}

	for (const att of params.attachments ?? []) {
		msg.addAttachment({
			filename: att.filename,
			contentType: att.type,
			data: att.content, // already base64
			encoding: "base64",
			inline: att.disposition === "inline",
			// mimetext wraps bare Content-ID values in <...> automatically
			...(att.contentId ? { headers: { "Content-ID": att.contentId } } : {}),
		});
	}

	const raw = msg.asRaw();

	// EmailMessage accepts a single envelope recipient; send one copy each.
	const recipients = [...new Set([...toList, ...ccList, ...bccList])];
	const outcomes: string[] = [];
	let firstMessageId: string | null = null;
	let firstError: unknown = null;
	for (const rcpt of recipients) {
		try {
			const result = await binding.send(
				new EmailMessage(from.email, rcpt, raw),
			);
			firstMessageId ??= result.messageId;
			outcomes.push(`${rcpt}: OK messageId=${result.messageId}`);
		} catch (e) {
			firstError ??= e;
			outcomes.push(
				`${rcpt}: FAILED ${(e as Error)?.message} (code ${(e as { code?: string })?.code ?? "?"})`,
			);
		}
	}

	await reportSendDebug(binding, params, from, raw, outcomes);

	if (!firstMessageId && firstError) throw firstError;
	return { messageId: firstMessageId ?? "" };
}

/**
 * Temporary diagnostics for inline-image sending.
 * Logs the generated raw MIME (long lines truncated) and delivers it as a
 * plain-text follow-up email to the same recipients, so the exact bytes
 * handed to the Email Service can be inspected in the recipient's mailbox.
 */
async function reportSendDebug(
	binding: SendEmail,
	params: SendEmailParams,
	from: { email: string; name?: string },
	raw: string,
	outcomes: string[],
): Promise<void> {
	try {
		const rawPreview = raw
			.split(/\r?\n/)
			.map((line) =>
				line.length > 200 ? `${line.slice(0, 200)}... [${line.length} chars]` : line,
			)
			.join("\n");
		const log = [
			`time: ${new Date().toISOString()}`,
			`envelope-from: ${from.email}`,
			`delivery: ${outcomes.join(" | ")}`,
			"",
			"--- raw MIME (truncated lines) ---",
			rawPreview,
		].join("\n");
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
