/**
 * Upload a local file to Notion and attach it to a page.
 *
 * Uses the Notion SDK's fileUploads API (single-part mode) to stream a local
 * file into Notion's storage, then appends a file block referencing the upload
 * to the target page.
 */

import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import * as path from 'node:path';
import type { Client } from '@notionhq/client';
import type { AnyPage, FileUploadsApi, UploadParams } from '../types.js';

/**
 * Extension-to-MIME-type map for common file types.
 *
 * Avoids pulling in a heavy dependency (e.g. `mime-types`) for a small set of
 * well-known extensions the Notion API is likely to encounter.
 */
const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Resolve a MIME type from a filename extension.
 *
 * Falls back to `application/octet-stream` for unknown extensions so uploads
 * never fail due to missing content-type metadata.
 *
 * @param filename - The file name or path to inspect.
 * @returns A MIME type string suitable for the `content_type` upload param.
 */
function inferContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Upload a local file to Notion and attach it as a file block on a page.
 *
 * The three-step process:
 * 1. Create a single-part file upload via the Notion API.
 * 2. Stream the file binary to the upload endpoint.
 * 3. Append a `file` block referencing the uploaded file to the target page.
 *
 * @param notion - An agent-scoped Notion SDK client.
 * @param params - Upload parameters including the local path and target page.
 * @returns Metadata about the upload and the target page URL.
 * @throws {Error} When the file does not exist, is not readable, or any
 *   Notion API call fails.
 */
export async function uploadNotionFile(
  notion: Client,
  params: UploadParams
): Promise<{
  file_upload_id: string;
  filename: string;
  content_type: string;
  page_id: string;
  page_url: string | null;
}> {
  const absolutePath = path.resolve(params.file_path);

  // Validate the file exists and is readable before touching the Notion API.
  // access() throws a descriptive ENOENT/EACCES error on failure.
  await access(absolutePath);

  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new Error(`Path is not a regular file: ${absolutePath}`);
  }

  const filename = params.display_name ?? path.basename(absolutePath);
  const contentType = params.content_type ?? inferContentType(absolutePath);

  // Step 1: Create a file upload slot in Notion.
  // The SDK types haven't caught up with fileUploads yet, so cast through
  // unknown to our typed interface — same pattern as getMarkdownPagesApi.
  const fileUploadsApi = notion.fileUploads as unknown as FileUploadsApi;
  const fileUpload = await fileUploadsApi.create({
    filename,
    content_type: contentType,
    mode: 'single_part',
  });

  const fileUploadId: string = fileUpload.id;

  // Step 2: Stream the file binary to Notion.
  // createReadStream avoids loading the entire file into memory.
  const readStream = createReadStream(absolutePath);
  await fileUploadsApi.send({
    file_upload_id: fileUploadId,
    file: readStream,
    filename,
  });

  // Step 3: Attach the uploaded file to the target page as a file block.
  // The `uploaded_file` block variant isn't in the SDK types yet, so we
  // cast through unknown to satisfy the append signature.
  const fileBlock = {
    type: 'file' as const,
    file: {
      type: 'uploaded_file' as const,
      uploaded_file: { id: fileUploadId },
    },
  };
  await notion.blocks.children.append({
    block_id: params.page_id,
    children: [fileBlock] as unknown as Parameters<
      typeof notion.blocks.children.append
    >[0]['children'],
  });

  // Retrieve the page to surface its URL in the response.
  let pageUrl: string | null = null;
  try {
    const page = (await notion.pages.retrieve({ page_id: params.page_id })) as AnyPage;
    pageUrl = page.url ?? null;
  } catch {
    // Non-fatal: the upload succeeded even if we can't resolve the page URL.
  }

  return {
    file_upload_id: fileUploadId,
    filename,
    content_type: contentType,
    page_id: params.page_id,
    page_url: pageUrl,
  };
}
