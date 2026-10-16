const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] ?? char));

export interface EmailContent {
  subject: string;
  heading: string;
  body: string;
  link: string;
  linkLabel: string;
}

export function renderEmail(content: EmailContent): { html: string; text: string } {
  const subject = escapeHtml(content.subject);
  const heading = escapeHtml(content.heading);
  const body = escapeHtml(content.body);
  const link = escapeHtml(content.link);
  const label = escapeHtml(content.linkLabel);
  return {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${subject}</title></head><body style="margin:0;background:#f3f6f7;font-family:Arial,sans-serif;color:#20323a"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden"><tr><td style="background:#10242b;padding:24px 32px;color:#fff;font-size:20px;font-weight:bold">Gogo Security <span style="color:#35c8bd">· TeamTask AI</span></td></tr><tr><td style="padding:32px"><h1 style="margin:0 0 16px;font-size:22px">${heading}</h1><p style="line-height:1.6;white-space:pre-line">${body}</p><p style="margin:28px 0"><a href="${link}" style="background:#21a99f;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;display:inline-block">${label}</a></p><p style="color:#718188;font-size:12px">Notification automatique · Gogo Security</p></td></tr></table></td></tr></table></body></html>`,
    text: `${content.heading}\n\n${content.body}\n\n${content.linkLabel}: ${content.link}\n\nGogo Security · TeamTask AI`,
  };
}

export const taskUrl = (appUrl: string, projectId: string, taskId: string) => `${projectUrl(appUrl, projectId)}?task=${encodeURIComponent(taskId)}`;
export const projectUrl = (appUrl: string, projectId: string) => `${appUrl.replace(/\/$/, '')}/projects/${encodeURIComponent(projectId)}`;
