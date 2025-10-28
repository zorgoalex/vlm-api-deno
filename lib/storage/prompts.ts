import { Prompt, PromptCreate, PromptUpdate, PromptListFilters, PromptListResult } from "./types.ts";
import { ulid } from "jsr:@std/ulid";

// We will open the KV store once and can reuse the instance.
const kv = await Deno.openKv();

/**
 * Creates a new prompt in the Deno KV store.
 *
 * @param data - The data for the new prompt.
 * @returns The fully created prompt object.
 * @throws Will throw an error if a prompt with the same name, namespace, and version already exists.
 */
export async function createPrompt(data: PromptCreate): Promise<Prompt> {
  const id = ulid(); // Generate a new unique, sortable ID
  const now = new Date().toISOString();

  const newPrompt: Prompt = {
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  };

  // Define keys for the atomic transaction
  const promptKey = ["prompts", id];
  // A secondary index to quickly find a prompt by its natural key (name, ns, etc.)
  const promptByNameKey = ["prompts_by_name", data.namespace, data.name, data.version];

  const res = await kv.atomic()
    // Ensure a prompt with the same natural key doesn't already exist
    .check({ key: promptByNameKey, versionstamp: null })
    // Set the main prompt object
    .set(promptKey, newPrompt)
    // Set the secondary index to point to the main prompt's ID
    .set(promptByNameKey, id)
    .commit();

  if (!res.ok) {
    throw new Error("Failed to create prompt: A prompt with the same name, namespace, and version may already exist.");
  }

  return newPrompt;
}

/**
 * Retrieves a single prompt by its unique ID.
 *
 * @param id - The unique ID of the prompt.
 * @returns The prompt object or null if not found.
 */
export async function getPrompt(id: string): Promise<Prompt | null> {
  const key = ["prompts", id];
  const entry = await kv.get<Prompt>(key);
  return entry.value ?? null;
}

/**
 * Updates an existing prompt by its unique ID.
 *
 * @param id - The unique ID of the prompt to update.
 * @param data - The partial data to update the prompt with.
 * @returns The fully updated prompt object, or null if the prompt was not found.
 * @throws Will throw an error if the update fails (e.g., due to a conflicting change).
 */
export async function updatePrompt(id: string, data: PromptUpdate): Promise<Prompt | null> {
  const promptKey = ["prompts", id];

  // Start a transaction to read the existing prompt
  const getRes = await kv.get<Prompt>(promptKey);
  if (!getRes.value) {
    return null; // Prompt not found
  }

  const existingPrompt = getRes.value;

  // Merge old and new data
  const updatedPrompt: Prompt = {
    ...existingPrompt,
    ...data,
    id, // Ensure ID is not changed
    updatedAt: new Date().toISOString(),
  };

  const atomicOp = kv.atomic()
    // Check ensures that the prompt hasn't been modified since we read it
    .check(getRes)
    // Set the updated prompt object
    .set(promptKey, updatedPrompt);

  // If the natural key (name, namespace, version) has changed, we must update the secondary index
  const nameChanged = data.name !== undefined && data.name !== existingPrompt.name;
  const namespaceChanged = data.namespace !== undefined && data.namespace !== existingPrompt.namespace;
  const versionChanged = data.version !== undefined && data.version !== existingPrompt.version;

  if (nameChanged || namespaceChanged || versionChanged) {
    const oldByNameKey = ["prompts_by_name", existingPrompt.namespace, existingPrompt.name, existingPrompt.version];
    const newByNameKey = ["prompts_by_name", updatedPrompt.namespace, updatedPrompt.name, updatedPrompt.version];

    // Add deletion of the old index and creation of the new one to the transaction
    atomicOp
      .delete(oldByNameKey)
      .set(newByNameKey, id);
  }

  const res = await atomicOp.commit();

  if (!res.ok) {
    throw new Error("Failed to update prompt: The prompt was modified by another process.");
  }

  return updatedPrompt;
}

/**
 * Deletes a prompt by its unique ID.
 * This operation is atomic and will also remove associated secondary indexes.
 *
 * @param id - The unique ID of the prompt to delete.
 * @returns {Promise<boolean>} True if the prompt was found and deleted, false otherwise.
 */
export async function deletePrompt(id: string): Promise<boolean> {
  const promptKey = ["prompts", id];

  // We need to read the prompt first to get details for deleting the secondary index
  const prompt = await getPrompt(id);
  if (!prompt) {
    return false; // Prompt not found
  }

  const byNameKey = ["prompts_by_name", prompt.namespace, prompt.name, prompt.version];

  const res = await kv.atomic()
    .delete(promptKey)
    .delete(byNameKey)
    .commit();

  return res.ok;
}

/**
 * Lists prompts with optional filtering, sorting and pagination.
 * Uses secondary index by namespace when possible, otherwise scans main prefix.
 */
export async function listPrompts(filters: PromptListFilters = {}): Promise<PromptListResult> {
  const {
    namespace,
    name,
    isActive,
    tag,
    limit = 50,
    cursor,
    sortBy = "updatedAt",
    sortOrder = "desc",
  } = filters;

  const items: Prompt[] = [];

  // Helper to push if matches remaining filters
  const matches = (p: Prompt) => {
    if (name && p.name !== name) return false;
    if (typeof isActive === "boolean" && p.isActive !== isActive) return false;
    if (tag && (!p.tags || !p.tags.includes(tag))) return false;
    return true;
  };

  let nextCursor: string | undefined = undefined;

  // Prefer index by namespace when provided (fast path)
  if (namespace && !name) {
    const iter = kv.list<string>({ prefix: ["prompts_by_name", namespace] }, { limit, cursor });
    for await (const entry of iter) {
      const promptId = entry.value;
      const p = await getPrompt(promptId);
      if (p && matches(p)) {
        items.push(p);
      }
      if (items.length >= limit) break;
    }
    // @ts-ignore cursor is available on iterator in Deno KV
    nextCursor = (iter as any).cursor as string | undefined;
  } else {
    // Fallback: scan main prefix
    const iter = kv.list<Prompt>({ prefix: ["prompts"] }, { limit: limit * 2, cursor });
    for await (const entry of iter) {
      const p = entry.value;
      if (!p) continue;
      if (namespace && p.namespace !== namespace) continue;
      if (!matches(p)) continue;
      items.push(p);
      if (items.length >= limit) break;
    }
    // @ts-ignore cursor is available on iterator in Deno KV
    nextCursor = (iter as any).cursor as string | undefined;
  }

  // Sorting in-memory according to requested criteria
  const dir = sortOrder === "asc" ? 1 : -1;
  items.sort((a, b) => {
    let av: number | string = 0;
    let bv: number | string = 0;
    if (sortBy === "priority") {
      av = a.priority; bv = b.priority;
    } else if (sortBy === "createdAt") {
      av = a.createdAt; bv = b.createdAt;
    } else {
      av = a.updatedAt; bv = b.updatedAt;
    }
    // ISO dates compare lexicographically
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  return { items, cursor: nextCursor };
}
