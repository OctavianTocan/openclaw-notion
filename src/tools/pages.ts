/**
 * Page lifecycle tools: delete, move, and publish.
 */

import type { Client } from '@notionhq/client';
import type { AnyPage, DeleteParams, MoveParams, PublishParams } from '../types.js';

/**
 * Soft-delete a Notion page by moving it to the trash.
 *
 * @param notion - Authenticated Notion client.
 * @param params - Contains the `page_id` to trash.
 * @returns The updated page object with `in_trash: true`.
 */
export async function deleteNotionPage(notion: Client, params: DeleteParams) {
  return notion.pages.update({ page_id: params.page_id, in_trash: true });
}

/**
 * Reparent a page under a new parent page.
 *
 * Prefers the typed `pages.move` method when available in the SDK,
 * falling back to a raw `POST /pages/{id}/move` request otherwise.
 *
 * @param notion - Authenticated Notion client.
 * @param params - Contains `page_id` and `new_parent_id`.
 * @returns The moved page response.
 */
export async function moveNotionPage(notion: Client, params: MoveParams) {
  if (typeof notion.pages.move === 'function') {
    return notion.pages.move({
      page_id: params.page_id,
      parent: { page_id: params.new_parent_id },
    });
  }

  // SDK does not expose pages.move yet — use the raw request path.
  return notion.request({
    path: `pages/${params.page_id}/move`,
    method: 'post',
    body: { parent: { page_id: params.new_parent_id } },
  });
}

/**
 * Stub for toggling public page sharing.
 *
 * The Notion API does not currently expose a publish/unpublish endpoint.
 * This tool exists so agents can attempt the operation and receive a clear
 * explanation of the limitation rather than a cryptic error.
 *
 * @param notion - Authenticated Notion client.
 * @param params - Contains `page_id` and optional `published` boolean.
 * @returns A structured report explaining the limitation.
 */
export async function publishNotionPage(notion: Client, params: PublishParams) {
  const page = (await notion.pages.retrieve({ page_id: params.page_id })) as AnyPage;
  return {
    supported: false,
    page_id: params.page_id,
    requested_state: params.published ?? true,
    url: page.url ?? null,
    public_url: page.public_url ?? null,
    message:
      "Notion's public sharing toggle is not exposed by the SDK or update endpoints " +
      'available to this plugin. The tool is a read-only stub until the API supports ' +
      'publish or unpublish.',
  };
}
