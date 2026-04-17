import type { Client } from "@notionhq/client";
import type { AnyPage, DeleteParams, MoveParams, PublishParams } from "../types.js";

export async function deleteNotionPage(notion: Client, params: DeleteParams) {
  return notion.pages.update({ page_id: params.page_id, in_trash: true });
}

export async function moveNotionPage(notion: Client, params: MoveParams) {
  if (typeof notion.pages.move === "function") {
    return notion.pages.move({
      page_id: params.page_id,
      parent: { page_id: params.new_parent_id },
    });
  }

  return notion.request({
    path: `pages/${params.page_id}/move`,
    method: "post",
    body: { parent: { page_id: params.new_parent_id } },
  });
}

export async function publishNotionPage(notion: Client, params: PublishParams) {
  const page = (await notion.pages.retrieve({ page_id: params.page_id })) as AnyPage;
  return {
    supported: false,
    page_id: params.page_id,
    requested_state: params.published ?? true,
    url: page.url ?? null,
    public_url: page.public_url ?? null,
    message:
      "Notion's public sharing toggle is not exposed by the SDK or update endpoints available to this plugin. The tool is a read-only stub until the API supports publish or unpublish.",
  };
}
