import { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { config } from '../config';
import { notionClient, withRetry } from '../integrations/notion';
import { PantryItem, PantryItemInput } from '../models/pantry-item';
import { Ingredient, IngredientUnit, IngredientUnitSchema } from '../models/recipe';

type NotionProperties = Parameters<typeof notionClient.pages.create>[0]['properties'];

function parsePantryPage(page: PageObjectResponse): PantryItem | null {
  const props = page.properties as unknown as Record<string, unknown>;

  const nameProp = props['Name'] as { title: Array<{ plain_text: string }> } | undefined;
  const name = (nameProp?.title ?? [])
    .map((t) => t.plain_text)
    .join('')
    .toLowerCase();
  if (!name) return null;

  const quantityProp = props['Quantity'] as { number: number | null } | undefined;
  const quantity = quantityProp?.number ?? 0;

  const unitProp = props['Unit'] as { select: { name: string } | null } | undefined;
  const unitRaw = unitProp?.select?.name ?? '';
  const unitResult = IngredientUnitSchema.safeParse(unitRaw);
  const unit: IngredientUnit = unitResult.success ? unitResult.data : 'other';

  const expiryProp = props['Expiry Date'] as { date: { start: string } | null } | undefined;
  const expiryDate = expiryProp?.date?.start ?? undefined;

  const thresholdProp = props['Min Threshold'] as { number: number | null } | undefined;
  const minThreshold = thresholdProp?.number !== null ? thresholdProp?.number : undefined;

  const updatedAtProp = props['Last Updated'] as { last_edited_time: string } | undefined;
  const updatedAt =
    updatedAtProp?.last_edited_time ?? page.last_edited_time ?? new Date().toISOString();

  return { id: page.id, name, quantity, unit, expiryDate, minThreshold, updatedAt };
}

export async function upsertItem(item: PantryItemInput): Promise<PantryItem> {
  const normalizedName = item.name.toLowerCase();

  const response = await withRetry(() =>
    notionClient.databases.query({
      database_id: config.notion.pantryDatabaseId,
      filter: { property: 'Name', title: { equals: normalizedName } },
    }),
  );

  const existing = response.results.find((p): p is PageObjectResponse => 'properties' in p);

  if (existing) {
    const existingItem = parsePantryPage(existing);
    const newQuantity = (existingItem?.quantity ?? 0) + item.quantity;

    const properties: NotionProperties = {
      Quantity: { number: newQuantity },
      Unit: { select: { name: item.unit } },
    };
    if (item.expiryDate) {
      properties['Expiry Date'] = { date: { start: item.expiryDate } };
    }
    if (item.minThreshold !== undefined) {
      properties['Min Threshold'] = { number: item.minThreshold };
    }

    const updated = await withRetry(() =>
      notionClient.pages.update({ page_id: existing.id, properties }),
    );

    return (
      parsePantryPage(updated as PageObjectResponse) ?? {
        id: existing.id,
        name: normalizedName,
        quantity: newQuantity,
        unit: item.unit,
        expiryDate: item.expiryDate,
        minThreshold: item.minThreshold,
        updatedAt: new Date().toISOString(),
      }
    );
  }

  const createProperties: NotionProperties = {
    Name: { title: [{ text: { content: normalizedName } }] },
    Quantity: { number: item.quantity },
    Unit: { select: { name: item.unit } },
  };
  if (item.expiryDate) {
    createProperties['Expiry Date'] = { date: { start: item.expiryDate } };
  }
  if (item.minThreshold !== undefined) {
    createProperties['Min Threshold'] = { number: item.minThreshold };
  }

  const page = await withRetry(() =>
    notionClient.pages.create({
      parent: { database_id: config.notion.pantryDatabaseId },
      properties: createProperties,
    }),
  );

  return (
    parsePantryPage(page as PageObjectResponse) ?? {
      id: page.id,
      name: normalizedName,
      quantity: item.quantity,
      unit: item.unit,
      expiryDate: item.expiryDate,
      minThreshold: item.minThreshold,
      updatedAt: new Date().toISOString(),
    }
  );
}

export async function listItems(): Promise<PantryItem[]> {
  const response = await withRetry(() =>
    notionClient.databases.query({
      database_id: config.notion.pantryDatabaseId,
    }),
  );

  const items = response.results
    .filter((p): p is PageObjectResponse => 'properties' in p)
    .map(parsePantryPage)
    .filter((p): p is PantryItem => p !== null);

  return items.sort((a, b) => {
    if (!a.expiryDate && !b.expiryDate) return 0;
    if (!a.expiryDate) return 1;
    if (!b.expiryDate) return -1;
    return a.expiryDate.localeCompare(b.expiryDate);
  });
}

export async function deductByMeal(ingredients: Ingredient[]): Promise<void> {
  for (const ingredient of ingredients) {
    const response = await withRetry(() =>
      notionClient.databases.query({
        database_id: config.notion.pantryDatabaseId,
        filter: {
          property: 'Name',
          title: { equals: ingredient.name.toLowerCase() },
        },
      }),
    );

    const existing = response.results.find((p): p is PageObjectResponse => 'properties' in p);
    if (!existing) continue;

    const item = parsePantryPage(existing);
    if (!item) continue;

    const newQuantity = Math.max(0, item.quantity - (ingredient.quantity ?? 0));
    await withRetry(() =>
      notionClient.pages.update({
        page_id: existing.id,
        properties: { Quantity: { number: newQuantity } },
      }),
    );
  }
}

export async function setThreshold(name: string, qty: number, unit: IngredientUnit): Promise<void> {
  const normalizedName = name.toLowerCase();
  const response = await withRetry(() =>
    notionClient.databases.query({
      database_id: config.notion.pantryDatabaseId,
      filter: { property: 'Name', title: { equals: normalizedName } },
    }),
  );

  const existing = response.results.find((p): p is PageObjectResponse => 'properties' in p);

  if (existing) {
    await withRetry(() =>
      notionClient.pages.update({
        page_id: existing.id,
        properties: {
          'Min Threshold': { number: qty },
          Unit: { select: { name: unit } },
        },
      }),
    );
  } else {
    await upsertItem({ name, quantity: 0, unit, minThreshold: qty });
  }
}

export async function checkExpiry(): Promise<PantryItem[]> {
  const twoDaysFromNow = new Date(Date.now() + 48 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0] as string;

  const response = await withRetry(() =>
    notionClient.databases.query({
      database_id: config.notion.pantryDatabaseId,
      filter: { property: 'Expiry Date', date: { on_or_before: twoDaysFromNow } },
    }),
  );

  return response.results
    .filter((p): p is PageObjectResponse => 'properties' in p)
    .map(parsePantryPage)
    .filter((p): p is PantryItem => p !== null && p.expiryDate !== undefined);
}

export async function checkThresholds(): Promise<PantryItem[]> {
  const items = await listItems();
  return items.filter(
    (item) => item.minThreshold !== undefined && item.quantity <= item.minThreshold,
  );
}
