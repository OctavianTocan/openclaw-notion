import type { Client } from "@notionhq/client";
import { DEFAULT_PAGE_SIZE } from "../constants.js";
import { parseJsonInput } from "../format.js";
import { shouldFallbackQuery } from "../helpers.js";
import type { LooseRecord, QueryableNotionClient, QueryParams, QueryResponse } from "../types.js";

export async function queryNotionDatabase(notion: Client, params: QueryParams) {
  const pageSize = params.page_size ?? DEFAULT_PAGE_SIZE;
  const filter = parseJsonInput<Record<string, unknown>>(params.filter, "filter");
  const sorts = parseJsonInput<Array<Record<string, unknown>>>(params.sorts, "sorts");

  const queryableNotion = notion as unknown as QueryableNotionClient;
  const queryFn = queryableNotion.databases.query?.bind(queryableNotion.databases);
  const dataSourceFn = queryableNotion.dataSources?.query?.bind(queryableNotion.dataSources);

  const mapResults = (results: QueryResponse["results"]) =>
    results.map((entry: LooseRecord) => ({
      id: entry.id,
      object: entry.object,
      url: entry.url ?? null,
      properties: entry.properties ?? null,
    }));

  if (queryFn) {
    try {
      const response = await queryFn({
        database_id: params.database_id,
        filter,
        sorts,
        page_size: pageSize,
      });
      return {
        mode: "database",
        database_id: params.database_id,
        page_size: pageSize,
        has_more: response.has_more,
        next_cursor: response.next_cursor,
        results: mapResults(response.results),
      };
    } catch (error) {
      if (!dataSourceFn || !shouldFallbackQuery(error)) {
        throw error;
      }
    }
  }

  if (!dataSourceFn) {
    throw new Error("Neither databases.query nor dataSources.query is available in the SDK.");
  }

  const response = await dataSourceFn({
    data_source_id: params.database_id,
    filter,
    sorts,
    page_size: pageSize,
  });
  return {
    mode: "data_source",
    database_id: params.database_id,
    page_size: pageSize,
    has_more: response.has_more,
    next_cursor: response.next_cursor,
    results: mapResults(response.results),
  };
}
