/**
 * Save a generated file. Inside a claude.ai artifact viewer the page cannot start
 * downloads itself, so it asks the viewer through the `downloads` capability;
 * everywhere else (local dev, self-hosted) it uses an ordinary download link.
 */
interface DownloadsNs {
  save(req: { filename: string; data: Blob | string | ArrayBuffer | ArrayBufferView }): Promise<{ status: string }>;
}
interface ClaudeHost {
  use(name: string): Promise<unknown>;
}

export type SaveOutcome = 'saved' | 'declined' | 'failed';

export async function saveFile(data: Uint8Array | string, filename: string, mime: string): Promise<SaveOutcome> {
  const blob = new Blob([data as BlobPart], { type: mime });
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (host?.use) {
    const downloads = (await host.use('downloads').catch(() => null)) as DownloadsNs | null;
    if (downloads) {
      try {
        await downloads.save({ filename, data: blob });
        return 'saved';
      } catch (e) {
        const code = (e as { code?: string }).code;
        return code === 'declined' ? 'declined' : 'failed';
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'saved';
}
